import { createHmac } from 'node:crypto';
import { computeGiteaSignature, verifyGiteaSignature } from './gitea-signature.util';

const SECRET = 'test-webhook-secret';
const BODY = JSON.stringify({ ref: 'refs/heads/main', commits: [] });

describe('computeGiteaSignature', () => {
  it('computes a deterministic bare hex HMAC-SHA256 digest (no "sha256=" prefix, unlike GitHub)', () => {
    const expected = createHmac('sha256', SECRET).update(BODY).digest('hex');
    expect(computeGiteaSignature(SECRET, BODY)).toBe(expected);
    expect(computeGiteaSignature(SECRET, BODY)).not.toMatch(/^sha256=/);
    expect(computeGiteaSignature(SECRET, BODY)).toBe(computeGiteaSignature(SECRET, BODY));
  });

  it('changes when the secret changes', () => {
    expect(computeGiteaSignature('secret-a', BODY)).not.toBe(
      computeGiteaSignature('secret-b', BODY),
    );
  });

  it('changes when the body changes', () => {
    expect(computeGiteaSignature(SECRET, BODY)).not.toBe(
      computeGiteaSignature(SECRET, BODY + 'x'),
    );
  });

  it('accepts a Buffer body and matches the string-body signature for identical bytes', () => {
    expect(computeGiteaSignature(SECRET, Buffer.from(BODY))).toBe(
      computeGiteaSignature(SECRET, BODY),
    );
  });
});

describe('verifyGiteaSignature', () => {
  it('returns true for a valid signature', () => {
    const sig = computeGiteaSignature(SECRET, BODY);
    expect(verifyGiteaSignature(SECRET, BODY, sig)).toBe(true);
  });

  it('returns false for an invalid signature (wrong secret)', () => {
    const sig = computeGiteaSignature('wrong-secret', BODY);
    expect(verifyGiteaSignature(SECRET, BODY, sig)).toBe(false);
  });

  it('returns false for a tampered body', () => {
    const sig = computeGiteaSignature(SECRET, BODY);
    expect(verifyGiteaSignature(SECRET, BODY + 'tampered', sig)).toBe(false);
  });

  it('returns false when the header is missing (undefined)', () => {
    expect(verifyGiteaSignature(SECRET, BODY, undefined)).toBe(false);
  });

  it('returns false when the header is null', () => {
    expect(verifyGiteaSignature(SECRET, BODY, null)).toBe(false);
  });

  it('returns false when the header is an empty string', () => {
    expect(verifyGiteaSignature(SECRET, BODY, '')).toBe(false);
  });

  it('returns false for a malformed / truncated signature (no exception)', () => {
    expect(verifyGiteaSignature(SECRET, BODY, 'deadbeef')).toBe(false);
    expect(verifyGiteaSignature(SECRET, BODY, 'sha256=' + computeGiteaSignature(SECRET, BODY))).toBe(false);
  });

  it('is rejected if a caller mistakenly sends a GitHub-style "sha256=" prefixed value', () => {
    const githubStyle = `sha256=${computeGiteaSignature(SECRET, BODY)}`;
    expect(verifyGiteaSignature(SECRET, BODY, githubStyle)).toBe(false);
  });

  it('works with a Buffer raw body (the real request.rawBody type)', () => {
    const sig = computeGiteaSignature(SECRET, Buffer.from(BODY));
    expect(verifyGiteaSignature(SECRET, Buffer.from(BODY), sig)).toBe(true);
  });
});
