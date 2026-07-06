/**
 * SSO/OIDC Phase 2 — a hand-built, cryptographically REAL SAML 2.0
 * `<samlp:Response>` fixture generator, used by `saml.service.spec.ts` to
 * exercise the full assertion-validation path (signature/audience/replay/
 * timestamp checks) against `@node-saml/node-saml` with ZERO network access
 * and no real IdP — a self-signed X.509 keypair (`selfsigned`, pure-JS, no
 * OpenSSL binary dependency) stands in for the IdP's signing key, and
 * `xml-crypto` (already a transitive dependency of `@node-saml/node-saml`,
 * added here as an explicit devDependency for direct use) produces a REAL
 * enveloped XML-DSig signature over the `<Assertion>` element — not a mock.
 *
 * This is deliberately NOT a mock of `@node-saml/node-saml` itself: the
 * whole point is to prove `SamlService` rejects a FORGED/tampered/replayed
 * assertion the same way a real attacker's attempt would be rejected by the
 * real, unmodified library.
 */
import { SignedXml } from 'xml-crypto';

export interface SamlAssertionFields {
  /** IdP's Entity ID (`<Issuer>`). */
  idpIssuer: string;
  /** Our SP Entity ID (`<AudienceRestriction><Audience>`). */
  audience: string;
  /** Our ACS callback URL (`Recipient`/`Destination`). */
  recipient: string;
  /** The `ID` of the AuthnRequest this is a response to (`InResponseTo`). Omit to build an IdP-initiated-shaped (no InResponseTo) response. */
  inResponseTo?: string;
  email: string;
  /** Omit (or set `includeDisplayName: false`) to build a response with no `displayName` attribute at all — for the "falls back to email local-part" test. */
  name?: string;
  /** Defaults to `true`. Set `false` to omit the `displayName` attribute entirely, regardless of `name`. */
  includeDisplayName?: boolean;
  /** Defaults to `now`. */
  issueInstant?: Date;
  /** Defaults to `issueInstant - 1 minute`. */
  notBefore?: Date;
  /** Defaults to `issueInstant + 5 minutes`. */
  notOnOrAfter?: Date;
}

function iso(d: Date): string {
  return d.toISOString().replace(/\.\d+Z$/, 'Z');
}

let counter = 0;
function uniqueId(prefix: string): string {
  counter += 1;
  return `_${prefix}${Date.now().toString(36)}${counter}`;
}

/** Builds the UNSIGNED Response+Assertion XML string. */
function buildUnsignedResponseXml(
  fields: SamlAssertionFields,
  responseId: string,
  assertionId: string,
): string {
  const issueInstant = fields.issueInstant ?? new Date();
  const notBefore = fields.notBefore ?? new Date(issueInstant.getTime() - 60_000);
  const notOnOrAfter = fields.notOnOrAfter ?? new Date(issueInstant.getTime() + 5 * 60_000);
  const name = fields.name ?? fields.email.split('@')[0];
  const includeDisplayName = fields.includeDisplayName ?? true;
  const inResponseToAttr = fields.inResponseTo ? ` InResponseTo="${fields.inResponseTo}"` : '';

  return [
    `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="${responseId}" Version="2.0" IssueInstant="${iso(issueInstant)}" Destination="${fields.recipient}"${inResponseToAttr}>`,
    `<saml:Issuer>${fields.idpIssuer}</saml:Issuer>`,
    `<samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>`,
    `<saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="${assertionId}" Version="2.0" IssueInstant="${iso(issueInstant)}">`,
    `<saml:Issuer>${fields.idpIssuer}</saml:Issuer>`,
    `<saml:Subject>`,
    `<saml:NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress">${fields.email}</saml:NameID>`,
    `<saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer">`,
    `<saml:SubjectConfirmationData${inResponseToAttr} NotOnOrAfter="${iso(notOnOrAfter)}" Recipient="${fields.recipient}"/>`,
    `</saml:SubjectConfirmation>`,
    `</saml:Subject>`,
    `<saml:Conditions NotBefore="${iso(notBefore)}" NotOnOrAfter="${iso(notOnOrAfter)}">`,
    `<saml:AudienceRestriction><saml:Audience>${fields.audience}</saml:Audience></saml:AudienceRestriction>`,
    `</saml:Conditions>`,
    `<saml:AuthnStatement AuthnInstant="${iso(issueInstant)}" SessionIndex="${uniqueId('session')}">`,
    `<saml:AuthnContext><saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport</saml:AuthnContextClassRef></saml:AuthnContext>`,
    `</saml:AuthnStatement>`,
    `<saml:AttributeStatement>`,
    `<saml:Attribute Name="email"><saml:AttributeValue>${fields.email}</saml:AttributeValue></saml:Attribute>`,
    ...(includeDisplayName
      ? [`<saml:Attribute Name="displayName"><saml:AttributeValue>${name}</saml:AttributeValue></saml:Attribute>`]
      : []),
    `</saml:AttributeStatement>`,
    `</saml:Assertion>`,
    `</samlp:Response>`,
  ].join('');
}

/**
 * Builds a REAL, signed SAML Response XML string (unencoded — callers
 * base64-encode for the `SAMLResponse` form field, matching what an IdP's
 * `<form method="post">` auto-submit actually sends).
 *
 * `signingKey`/`signingCert` are the PEM keypair that signs the assertion —
 * pass the fixture's own keypair for a VALID response, or a DIFFERENT
 * keypair to build a forged-signature test case.
 */
export function buildSignedSamlResponse(
  fields: SamlAssertionFields,
  signingKey: string,
  signingCert: string,
): string {
  const responseId = uniqueId('resp');
  const assertionId = uniqueId('assertion');
  const xml = buildUnsignedResponseXml(fields, responseId, assertionId);

  const sig = new SignedXml({
    privateKey: signingKey,
    publicCert: signingCert,
    signatureAlgorithm: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
    canonicalizationAlgorithm: 'http://www.w3.org/2001/10/xml-exc-c14n#',
  });
  sig.addReference({
    xpath: `//*[@ID='${assertionId}']`,
    transforms: [
      'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
      'http://www.w3.org/2001/10/xml-exc-c14n#',
    ],
    digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256',
  });
  sig.computeSignature(xml, {
    location: {
      // Scoped to the Assertion's own Issuer (the Response also has one) —
      // standard SAML placement: Signature immediately follows Issuer.
      reference: "//*[local-name(.)='Assertion']/*[local-name(.)='Issuer']",
      action: 'after',
    },
  });

  return sig.getSignedXml();
}

/** Builds an UNSIGNED response (no `<ds:Signature>` at all) — for the "unsigned assertion rejected" test case. */
export function buildUnsignedSamlResponse(fields: SamlAssertionFields): string {
  return buildUnsignedResponseXml(fields, uniqueId('resp'), uniqueId('assertion'));
}
