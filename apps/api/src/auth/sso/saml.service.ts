/**
 * SamlService — SSO/OIDC Phase 2, the SAML 2.0 half of the N-simultaneous
 * -providers list. SP-initiated flow only (no IdP-initiated support in v1 —
 * see `sso.controller.ts`'s header comment): we generate the `AuthnRequest`
 * (HTTP-Redirect binding) and validate the resulting `AuthnResponse` posted
 * back to our ACS (assertion consumer service) endpoint.
 *
 * Library: `@node-saml/node-saml` (actively maintained fork of the
 * long-standing `passport-saml`/`node-saml` lineage; used directly rather
 * than via `passport-saml`'s Passport strategy wrapper since this app's
 * OIDC flow already talks to `openid-client` directly, not through
 * Passport — consistent with the existing architecture, one fewer
 * abstraction layer).
 *
 * ASSERTION VALIDATION STRICTNESS (documented per non-negotiable):
 *   - `wantAssertionsSigned: true`, ALWAYS — hardcoded, never admin
 *     configurable off. A SAML response without a validly-signed assertion
 *     (against the configured `samlIdpCertificate`) is rejected outright by
 *     the library (`validatePostResponseAsync` throws "Invalid signature").
 *     `wantAuthnResponseSigned` (whether the outer `<Response>` envelope
 *     ALSO needs its own signature) is explicitly set `false` — the
 *     assertion signature alone is the trust boundary; requiring both would
 *     reject interoperable IdPs (Okta/Azure AD/ADFS defaults) that sign only
 *     the assertion, which is the more common real-world configuration.
 *   - `audience` is ALWAYS enforced (never `false`) — set to the provider's
 *     `samlSpEntityId` (or the computed default). The library checks the
 *     assertion's `<AudienceRestriction>` against it and throws on mismatch,
 *     preventing "audience confusion" (an assertion minted for a different
 *     SP being replayed against ours).
 *   - `validateInResponseTo: ifPresent` — our AuthnRequest always carries an
 *     `ID`, so a legitimate SP-initiated response always carries
 *     `InResponseTo`; the library single-use-consumes it via
 *     `SamlCacheProviderFactory`'s cache (5-minute window — see that file),
 *     rejecting replays and responses to requests we never made.
 *   - `<Conditions NotBefore/NotOnOrAfter>` are ALWAYS checked by the library
 *     regardless of config (`checkTimestampsValidityError`) — a small
 *     `acceptedClockSkewMs` allowance covers IdP/SP clock drift.
 *   - KNOWN GAP (documented, not silently ignored): `@node-saml/node-saml`
 *     does not independently re-verify `SubjectConfirmationData/@Recipient`
 *     against our own ACS URL (a defense some SAML stacks add against a
 *     signed assertion being replayed at a different SP's ACS endpoint).
 *     In practice this is mitigated by the combination already enforced
 *     here — signed assertion + audience restriction + single-use
 *     InResponseTo tracking — which together prevent cross-SP replay for
 *     any IdP that signs assertions (required here); a full custom
 *     Recipient check would mean hand-parsing the assertion XML ourselves,
 *     which we've deliberately avoided in favor of the audited library path.
 *   - Multiple `<Assertion>` elements in one response are rejected by the
 *     library outright ("Invalid signature: multiple assertions") — a
 *     defense against signature-scope confusion attacks.
 */
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { SAML, ValidateInResponseTo } from '@node-saml/node-saml';
import type { Profile } from '@node-saml/node-saml';
import { createHash } from 'crypto';
import { SamlCacheProviderFactory, SAML_REQUEST_TTL_MS } from './saml-cache-provider';
import { defaultSpEntityId } from '../../admin-settings/sso-providers.service';

export interface SamlProviderConfig {
  slug: string;
  samlEntryPoint: string;
  samlIdpIssuer: string;
  samlIdpCertificate: string;
  samlSpEntityId: string | null;
}

function fingerprint(config: SamlProviderConfig, callbackUrl: string): string {
  return createHash('sha256')
    .update(
      `${config.samlEntryPoint}::${config.samlIdpIssuer}::${config.samlIdpCertificate}::${config.samlSpEntityId ?? ''}::${callbackUrl}`,
    )
    .digest('hex');
}

/** Attribute names covering the common IdPs (Okta/Auth0/Azure AD/ADFS/generic SAML) — no universal claim spec exists, so this is a documented, reasonable finite list, same posture as OIDC's `claims.email`. */
function extractEmail(profile: Profile): string | null {
  const candidates: unknown[] = [
    profile.email,
    profile.mail,
    profile['urn:oid:0.9.2342.19200300.100.1.3'], // LDAP "mail" attribute OID
    profile['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress'], // ADFS/Azure AD
  ];
  // Fall back to the NameID only when it's actually formatted as an email address.
  if (profile.nameIDFormat?.toLowerCase().includes('emailaddress')) {
    candidates.push(profile.nameID);
  }
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim().includes('@')) {
      return candidate.trim().toLowerCase();
    }
  }
  return null;
}

function extractName(profile: Profile, fallbackEmail: string): string {
  const directCandidates: unknown[] = [
    profile['displayName'],
    profile['name'],
    profile['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name'],
  ];
  for (const candidate of directCandidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }

  const first = profile['givenName'] ?? profile['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname'];
  const last = profile['sn'] ?? profile['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname'];
  if (typeof first === 'string' && typeof last === 'string' && (first.trim() || last.trim())) {
    return `${first} ${last}`.trim();
  }

  return fallbackEmail.split('@')[0];
}

@Injectable()
export class SamlService {
  private readonly logger = new Logger(SamlService.name);
  private readonly clientCache = new Map<string, { fingerprint: string; client: SAML }>();

  constructor(private readonly cacheProviderFactory: SamlCacheProviderFactory) {}

  private getClient(config: SamlProviderConfig, callbackUrl: string): SAML {
    const fp = fingerprint(config, callbackUrl);
    const cached = this.clientCache.get(config.slug);
    if (cached?.fingerprint === fp) return cached.client;

    const audience = config.samlSpEntityId || defaultSpEntityId(config.slug);
    const client = new SAML({
      entryPoint: config.samlEntryPoint,
      issuer: audience,
      callbackUrl,
      idpCert: config.samlIdpCertificate,
      // Strictness — see this file's header comment. Never admin-configurable off.
      wantAssertionsSigned: true,
      // The ASSERTION must always be signed (above); the outer `<Response>`
      // envelope additionally being signed is NOT required — many
      // real-world IdPs (Okta, Azure AD, ADFS defaults) sign only the
      // assertion, not the outer response, and node-saml's own default
      // (`wantAuthnResponseSigned: true`) would reject those interoperable,
      // correctly-configured IdPs outright. `wantAssertionsSigned` alone is
      // the actual trust boundary here.
      wantAuthnResponseSigned: false,
      audience,
      validateInResponseTo: ValidateInResponseTo.ifPresent,
      requestIdExpirationPeriodMs: SAML_REQUEST_TTL_MS,
      acceptedClockSkewMs: 5000,
      cacheProvider: this.cacheProviderFactory.create(),
      // Most IdPs don't support (or mis-implement) AuthnContext class-ref
      // negotiation for a bare generic-OIDC-style SSO setup; disabling this
      // avoids spurious IdP-side rejections for providers we don't control.
      disableRequestedAuthnContext: true,
    });
    this.clientCache.set(config.slug, { fingerprint: fp, client });
    return client;
  }

  /** Builds the SP-initiated AuthnRequest redirect URL (HTTP-Redirect binding). `RelayState` carries the provider slug back — defense-in-depth alongside the callback route's own `:slug` path param. */
  async buildLoginRedirectUrl(config: SamlProviderConfig, callbackUrl: string): Promise<string> {
    const client = this.getClient(config, callbackUrl);
    return client.getAuthorizeUrlAsync(config.slug, undefined, {});
  }

  /** Validates the ACS POST body and returns `{ email, name }` extracted from the verified assertion. Throws `BadRequestException` on any validation failure (signature/audience/replay/timestamp — see this file's header comment). */
  async validateResponseAndExtractIdentity(
    config: SamlProviderConfig,
    callbackUrl: string,
    samlResponse: string,
  ): Promise<{ email: string; name: string }> {
    const client = this.getClient(config, callbackUrl);

    let profile: Profile | null;
    try {
      const result = await client.validatePostResponseAsync({ SAMLResponse: samlResponse });
      profile = result.profile;
      if (result.loggedOut) {
        throw new Error('unexpected LogoutResponse at the ACS endpoint');
      }
    } catch (err) {
      // Never surface the raw error in the user-facing message — it may
      // embed assertion XML fragments. Log server-side only (mirrors
      // OidcService's token-exchange failure handling exactly).
      this.logger.warn(
        `[saml:${config.slug}] Response validation failed: ${err instanceof Error ? err.message : 'unknown error'}`,
      );
      throw new BadRequestException(
        "SSO sign-in failed — the identity provider's response could not be verified",
      );
    }

    if (!profile) {
      throw new BadRequestException('SSO sign-in failed — the identity provider did not return a valid assertion');
    }

    const email = extractEmail(profile);
    if (!email) {
      throw new BadRequestException('The identity provider did not return an email address');
    }

    return { email, name: extractName(profile, email) };
  }
}
