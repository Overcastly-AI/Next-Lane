import { createHmac } from 'node:crypto';
import { computeGithubSignature, verifyGithubSignature } from './github-signature.util';

const SECRET = 'test-webhook-secret';
const BODY = JSON.stringify({ ref: 'refs/heads/main', commits: [] });

describe('computeGithubSignature', () => {
  it('computes a deterministic sha256=<hmac> value', () => {
    const expected = 'sha256=' + createHmac('sha256', SECRET).update(BODY).digest('hex');
    expect(computeGithubSignature(SECRET, BODY)).toBe(expected);
    expect(computeGithubSignature(SECRET, BODY)).toBe(computeGithubSignature(SECRET, BODY));
  });

  it('changes when the secret changes', () => {
    expect(computeGithubSignature('secret-a', BODY)).not.toBe(
      computeGithubSignature('secret-b', BODY),
    );
  });

  it('changes when the body changes', () => {
    expect(computeGithubSignature(SECRET, BODY)).not.toBe(
      computeGithubSignature(SECRET, BODY + 'x'),
    );
  });

  it('accepts a Buffer body and matches the string-body signature for identical bytes', () => {
    expect(computeGithubSignature(SECRET, Buffer.from(BODY))).toBe(
      computeGithubSignature(SECRET, BODY),
    );
  });
});

describe('verifyGithubSignature', () => {
  it('returns true for a valid signature', () => {
    const sig = computeGithubSignature(SECRET, BODY);
    expect(verifyGithubSignature(SECRET, BODY, sig)).toBe(true);
  });

  it('returns false for an invalid signature (wrong secret)', () => {
    const sig = computeGithubSignature('wrong-secret', BODY);
    expect(verifyGithubSignature(SECRET, BODY, sig)).toBe(false);
  });

  it('returns false for a tampered body', () => {
    const sig = computeGithubSignature(SECRET, BODY);
    expect(verifyGithubSignature(SECRET, BODY + 'tampered', sig)).toBe(false);
  });

  it('returns false when the header is missing (undefined)', () => {
    expect(verifyGithubSignature(SECRET, BODY, undefined)).toBe(false);
  });

  it('returns false when the header is null', () => {
    expect(verifyGithubSignature(SECRET, BODY, null)).toBe(false);
  });

  it('returns false when the header is an empty string', () => {
    expect(verifyGithubSignature(SECRET, BODY, '')).toBe(false);
  });

  it('returns false for a malformed / truncated signature (no exception)', () => {
    expect(verifyGithubSignature(SECRET, BODY, 'sha256=deadbeef')).toBe(false);
    expect(verifyGithubSignature(SECRET, BODY, 'not-even-hex-prefixed')).toBe(false);
  });

  it('works with a Buffer raw body (the real request.rawBody type)', () => {
    const sig = computeGithubSignature(SECRET, Buffer.from(BODY));
    expect(verifyGithubSignature(SECRET, Buffer.from(BODY), sig)).toBe(true);
  });
});
