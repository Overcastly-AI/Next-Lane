/**
 * SamlService — SSO/OIDC Phase 2 SAML assertion validation, exercised
 * end-to-end against the REAL `@node-saml/node-saml` library with a
 * self-signed X.509 keypair standing in for the IdP (zero network, zero real
 * IdP — see `__fixtures__/saml-response.fixture.ts` for how the signed
 * fixture responses are built).
 *
 * This is the "local mock/self-signed SAML response fixture" acceptance
 * criterion: every assertion-validation strictness claim documented in
 * `saml.service.ts`'s header comment is proven here against real XML-DSig
 * signature verification, not a mocked library.
 *
 * Covers:
 *   - a validly signed, fresh SP-initiated response is ACCEPTED and the
 *     right email/name are extracted
 *   - FORGED assertions are rejected: signed by a different keypair than the
 *     configured IdP certificate, tampered post-signature (digest mismatch),
 *     entirely unsigned
 *   - audience confusion (assertion minted for a different SP) is rejected
 *   - expired assertions (NotOnOrAfter in the past) are rejected
 *   - replay protection: a response for an `InResponseTo` we never issued,
 *     and re-submitting an already-consumed one, are both rejected
 */
import { BadRequestException } from '@nestjs/common';
import { generate as generateCert } from 'selfsigned';
import { inflateRawSync } from 'zlib';
import { SamlService, type SamlProviderConfig } from './saml.service';
import { SamlCacheProviderFactory } from './saml-cache-provider';
import { buildSignedSamlResponse, buildUnsignedSamlResponse } from './__fixtures__/saml-response.fixture';

const CALLBACK_URL = 'https://tracker.example.com/api/auth/sso/corp-adfs/callback';
const AUDIENCE = 'https://tracker.example.com/api/auth/sso/corp-adfs';
const IDP_ISSUER = 'https://idp.example.com/adfs/services/trust';

function toBase64(xml: string): string {
  return Buffer.from(xml, 'utf8').toString('base64');
}

describe('SamlService (real @node-saml/node-saml, self-signed fixture, zero network)', () => {
  let idpCert: string;
  let idpKey: string;
  let attackerCert: string;
  let attackerKey: string;
  let service: SamlService;

  const config: SamlProviderConfig = {
    slug: 'corp-adfs',
    samlEntryPoint: 'https://idp.example.com/adfs/ls',
    samlIdpIssuer: IDP_ISSUER,
    samlIdpCertificate: '', // filled in beforeAll once idpCert is generated
    samlSpEntityId: AUDIENCE,
  };

  beforeAll(async () => {
    const idp = await generateCert([{ name: 'commonName', value: 'Test IdP' }], {
      keySize: 2048,
    });
    idpCert = idp.cert;
    idpKey = idp.private;
    config.samlIdpCertificate = idpCert;

    const attacker = await generateCert([{ name: 'commonName', value: 'Attacker' }], {
      keySize: 2048,
    });
    attackerCert = attacker.cert;
    attackerKey = attacker.private;
  }, 30_000);

  beforeEach(() => {
    // Fresh service (fresh client + replay cache) per test — no cross-test
    // InResponseTo contamination. No Redis configured — falls back to the
    // in-memory cache provider (correct for this single-process test).
    service = new SamlService(new SamlCacheProviderFactory(null));
  });

  /** Generates a real AuthnRequest via the service and extracts its `ID` — the `InResponseTo` a legitimate response must carry. */
  async function issueAuthnRequestId(): Promise<string> {
    const url = await service.buildLoginRedirectUrl(config, CALLBACK_URL);
    const parsed = new URL(url);
    const samlRequestB64 = parsed.searchParams.get('SAMLRequest');
    expect(samlRequestB64).toBeTruthy();
    const xml = inflateRawSync(Buffer.from(samlRequestB64!, 'base64')).toString('utf8');
    const match = xml.match(/<samlp:AuthnRequest[^>]*\bID="([^"]+)"/);
    expect(match).not.toBeNull();
    return match![1];
  }

  it('builds a login redirect URL pointing at the configured entryPoint', async () => {
    const url = await service.buildLoginRedirectUrl(config, CALLBACK_URL);
    expect(url.startsWith(config.samlEntryPoint)).toBe(true);
    expect(new URL(url).searchParams.get('RelayState')).toBe(config.slug);
  });

  it('accepts a validly signed, fresh SP-initiated response and extracts email/name', async () => {
    const inResponseTo = await issueAuthnRequestId();
    const xml = buildSignedSamlResponse(
      {
        idpIssuer: IDP_ISSUER,
        audience: AUDIENCE,
        recipient: CALLBACK_URL,
        inResponseTo,
        email: 'alice@corp.example.com',
        name: 'Alice Example',
      },
      idpKey,
      idpCert,
    );

    const result = await service.validateResponseAndExtractIdentity(config, CALLBACK_URL, toBase64(xml));
    expect(result).toEqual({ email: 'alice@corp.example.com', name: 'Alice Example' });
  });

  it('falls back to the email local-part as the name when no displayName attribute is present', async () => {
    const inResponseTo = await issueAuthnRequestId();
    const xml = buildSignedSamlResponse(
      {
        idpIssuer: IDP_ISSUER,
        audience: AUDIENCE,
        recipient: CALLBACK_URL,
        inResponseTo,
        email: 'bob@corp.example.com',
        includeDisplayName: false,
      },
      idpKey,
      idpCert,
    );

    const result = await service.validateResponseAndExtractIdentity(config, CALLBACK_URL, toBase64(xml));
    expect(result).toEqual({ email: 'bob@corp.example.com', name: 'bob' });
  });

  // ---------------------------------------------------------------------------
  // Forged-assertion rejection
  // ---------------------------------------------------------------------------

  it('REJECTS an assertion signed by a different (forged) keypair than the configured IdP certificate', async () => {
    const inResponseTo = await issueAuthnRequestId();
    const xml = buildSignedSamlResponse(
      { idpIssuer: IDP_ISSUER, audience: AUDIENCE, recipient: CALLBACK_URL, inResponseTo, email: 'mallory@evil.example.com' },
      attackerKey,
      attackerCert,
    );

    await expect(
      service.validateResponseAndExtractIdentity(config, CALLBACK_URL, toBase64(xml)),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('REJECTS a validly-signed assertion that was tampered with afterward (digest mismatch)', async () => {
    const inResponseTo = await issueAuthnRequestId();
    const xml = buildSignedSamlResponse(
      { idpIssuer: IDP_ISSUER, audience: AUDIENCE, recipient: CALLBACK_URL, inResponseTo, email: 'alice@corp.example.com', name: 'Alice Example' },
      idpKey,
      idpCert,
    );
    // Attacker intercepts the (validly signed) response and rewrites the
    // display name — any byte change inside the signed Assertion subtree
    // invalidates the digest.
    const tampered = xml.replace('Alice Example', 'Mallory Hacker');
    expect(tampered).not.toBe(xml);

    await expect(
      service.validateResponseAndExtractIdentity(config, CALLBACK_URL, toBase64(tampered)),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('REJECTS a response with no signature at all (wantAssertionsSigned is never admin-configurable off)', async () => {
    const inResponseTo = await issueAuthnRequestId();
    const xml = buildUnsignedSamlResponse({
      idpIssuer: IDP_ISSUER,
      audience: AUDIENCE,
      recipient: CALLBACK_URL,
      inResponseTo,
      email: 'alice@corp.example.com',
    });

    await expect(
      service.validateResponseAndExtractIdentity(config, CALLBACK_URL, toBase64(xml)),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('REJECTS an assertion minted for a different audience (SP audience confusion)', async () => {
    const inResponseTo = await issueAuthnRequestId();
    const xml = buildSignedSamlResponse(
      {
        idpIssuer: IDP_ISSUER,
        audience: 'https://a-completely-different-sp.example.com',
        recipient: CALLBACK_URL,
        inResponseTo,
        email: 'alice@corp.example.com',
      },
      idpKey,
      idpCert,
    );

    await expect(
      service.validateResponseAndExtractIdentity(config, CALLBACK_URL, toBase64(xml)),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('REJECTS an expired assertion (NotOnOrAfter in the past)', async () => {
    const inResponseTo = await issueAuthnRequestId();
    const issueInstant = new Date(Date.now() - 10 * 60_000);
    const xml = buildSignedSamlResponse(
      {
        idpIssuer: IDP_ISSUER,
        audience: AUDIENCE,
        recipient: CALLBACK_URL,
        inResponseTo,
        email: 'alice@corp.example.com',
        issueInstant,
        notBefore: new Date(issueInstant.getTime() - 60_000),
        notOnOrAfter: new Date(issueInstant.getTime() + 60_000), // expired 9 minutes ago
      },
      idpKey,
      idpCert,
    );

    await expect(
      service.validateResponseAndExtractIdentity(config, CALLBACK_URL, toBase64(xml)),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  // ---------------------------------------------------------------------------
  // Replay protection (InResponseTo)
  // ---------------------------------------------------------------------------

  it('REJECTS a response for an InResponseTo this SP never issued', async () => {
    const xml = buildSignedSamlResponse(
      {
        idpIssuer: IDP_ISSUER,
        audience: AUDIENCE,
        recipient: CALLBACK_URL,
        inResponseTo: '_never-issued-request-id',
        email: 'alice@corp.example.com',
      },
      idpKey,
      idpCert,
    );

    await expect(
      service.validateResponseAndExtractIdentity(config, CALLBACK_URL, toBase64(xml)),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('REJECTS replaying an already-consumed InResponseTo (single-use)', async () => {
    const inResponseTo = await issueAuthnRequestId();
    const xml = buildSignedSamlResponse(
      { idpIssuer: IDP_ISSUER, audience: AUDIENCE, recipient: CALLBACK_URL, inResponseTo, email: 'alice@corp.example.com' },
      idpKey,
      idpCert,
    );
    const encoded = toBase64(xml);

    // First use succeeds and consumes the single-use InResponseTo entry.
    await expect(service.validateResponseAndExtractIdentity(config, CALLBACK_URL, encoded)).resolves.toEqual({
      email: 'alice@corp.example.com',
      name: 'alice',
    });

    // Replaying the identical response is rejected.
    await expect(
      service.validateResponseAndExtractIdentity(config, CALLBACK_URL, encoded),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
