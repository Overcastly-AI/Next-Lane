// @vitest-environment jsdom
/**
 * Guard: the jsdom test environment actually loads.
 *
 * This exists because of a real near-miss. `jsdom@30` pulls in `undici@8`,
 * which calls a `node:worker_threads` API that CI's Node 20 does not have, so
 * `new CacheStorage` threw at import time and EVERY file with
 * `// @vitest-environment jsdom` was skipped. The run reported
 * "2 passed (2) / 11 passed (11)" — a green-looking summary that had quietly
 * dropped 13 sanitizer tests, including the ones guarding a change to
 * DOMPurify's URI allowlist.
 *
 * Vitest did surface it as an unhandled error and fail the run, which is the
 * primary protection. This file is the second one: it names the dependency in
 * a place a failure is legible ("the DOM environment is broken") rather than
 * as a stack trace inside undici, and it fails as a MISSING TEST rather than
 * as absent coverage if someone ever reaches for
 * `dangerouslyIgnoreUnhandledErrors`.
 *
 * If this file fails, do not chase the symptom — check whether a dependency
 * bumped jsdom past what `engines.node` (>=20) supports.
 */
import { describe, expect, it } from 'vitest';

describe('jsdom test environment', () => {
  it('provides a real DOM', () => {
    const el = document.createElement('div');
    el.innerHTML = '<p id="x">hello</p>';
    expect(el.querySelector('#x')?.textContent).toBe('hello');
  });

  it('runs DOMPurify, which is what the DOM is here for', async () => {
    const DOMPurify = (await import('dompurify')).default;
    // Not a security assertion — `MarkdownRenderer`'s config and hooks own
    // that, and `lib/pageImages.test.ts` covers them. This only proves the
    // library can initialise against this environment at all.
    expect(DOMPurify.sanitize('<b>ok</b><script>bad()</script>')).toBe('<b>ok</b>');
  });
});
