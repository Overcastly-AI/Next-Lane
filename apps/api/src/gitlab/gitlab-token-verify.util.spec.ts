import { verifyGitlabToken } from './gitlab-token-verify.util';

const SECRET = 'test-webhook-secret-value';

describe('verifyGitlabToken', () => {
  it('returns true when the header exactly matches the stored secret', () => {
    expect(verifyGitlabToken(SECRET, SECRET)).toBe(true);
  });

  it('returns false for a wrong secret (same length, different bytes)', () => {
    const wrong = 'x'.repeat(SECRET.length);
    expect(verifyGitlabToken(SECRET, wrong)).toBe(false);
  });

  it('returns false for a differently-sized wrong secret', () => {
    expect(verifyGitlabToken(SECRET, 'too-short')).toBe(false);
    expect(verifyGitlabToken(SECRET, SECRET + 'extra-suffix')).toBe(false);
  });

  it('returns false when the header is missing (undefined)', () => {
    expect(verifyGitlabToken(SECRET, undefined)).toBe(false);
  });

  it('returns false when the header is null', () => {
    expect(verifyGitlabToken(SECRET, null)).toBe(false);
  });

  it('returns false when the header is an empty string', () => {
    expect(verifyGitlabToken(SECRET, '')).toBe(false);
  });

  it('is case-sensitive (GitLab secrets are opaque tokens, not case-folded)', () => {
    expect(verifyGitlabToken(SECRET, SECRET.toUpperCase())).toBe(false);
  });

  it('never throws on adversarial length mismatches', () => {
    expect(() => verifyGitlabToken(SECRET, 'a')).not.toThrow();
    expect(() => verifyGitlabToken(SECRET, 'a'.repeat(10_000))).not.toThrow();
  });
});
