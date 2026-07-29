#!/usr/bin/env node
/**
 * Print a COMPACT list of failing Playwright tests from a JSON report.
 *
 * Why this exists: a red e2e run was effectively undiagnosable.
 *   - `get_job_logs` (Actions API) is tail-only, and the Playwright output
 *     sits ~500 lines from the end, behind the server-log dump and the
 *     artifact-upload chatter — so a normal tail lands in cleanup noise.
 *   - Playwright's `github` reporter writes annotations, which the checks
 *     API does not expose in `output.text` (it comes back empty).
 *   - The HTML report is a 10-19 MB artifact that can only be read by
 *     downloading it.
 *
 * Net effect was that the suite sat red for 25 days with nobody — human or
 * agent — able to see WHICH tests were failing. This script runs LAST in the
 * job so a small tail of the log always contains the full failure list.
 *
 * Usage: node scripts/summarize-playwright.mjs <results.json>
 * Never fails the build: this is a reporting aid, and masking the real
 * failure with a reporting crash would be its own regression.
 */
import fs from 'node:fs';

const file = process.argv[2];
if (!file || !fs.existsSync(file)) {
  console.log(`(no Playwright JSON report at ${file ?? '<unset>'} — nothing to summarize)`);
  process.exit(0);
}

/**
 * First N meaningful lines of an error, with ANSI codes stripped.
 *
 * 16, not 4. A `toEqual` diff spends its first four lines on the header
 * ("Error: expect(received).toEqual(expected)", "- Expected  - 1",
 * "+ Received  + 1", "Array [") and only THEN prints the elements — so a
 * 4-line budget printed literally `Array [` and nothing else. A page-reorder
 * failure was chased across three CI rounds with nobody able to see which
 * order the server actually ended up in. The whole point of this script is
 * that a tail-only reader can diagnose the run; truncating mid-diff defeats
 * it. Still bounded, so one runaway stack can't bury the other failures.
 */
function briefError(err, maxLines = 16) {
  const raw = [err?.message, err?.stack].filter(Boolean).join('\n');
  return raw
    // eslint-disable-next-line no-control-regex
    .replace(/\[[0-9;]*m/g, '')
    .split('\n')
    .map((l) => l.trimEnd())
    .filter((l) => l.trim() !== '')
    .slice(0, maxLines)
    .map((l) => `      ${l}`)
    .join('\n');
}

/** Walk the nested suite tree; Playwright nests suites by file then describe. */
function collect(suite, out) {
  for (const spec of suite.specs ?? []) {
    for (const test of spec.tests ?? []) {
      // `status` is the expected-vs-actual outcome; only surface real failures
      // (a flaky test that passed on retry is not a failure).
      const bad = ['unexpected', 'timedOut'].includes(test.status);
      if (!bad) continue;
      const result = (test.results ?? []).find((r) => r.error) ?? {};
      const loc = result.error?.location;
      out.push({
        project: test.projectName ?? '?',
        file: spec.file ?? suite.file ?? '?',
        line: spec.line ?? 0,
        title: spec.title ?? '?',
        // WHICH assertion blew up, not just which test. A test that asserts
        // the same expectation twice (e.g. the page-reorder spec checks the
        // identical order before AND after its reload) is otherwise
        // impossible to place from the tail of a CI log: the diff alone can
        // be produced by either line, and those two lines mean completely
        // different things.
        at: loc ? `${loc.file?.split('/').pop() ?? '?'}:${loc.line}:${loc.column}` : null,
        error: result.error ? briefError(result.error) : '      (no error captured)',
      });
    }
  }
  for (const child of suite.suites ?? []) collect(child, out);
}

let report;
try {
  report = JSON.parse(fs.readFileSync(file, 'utf8'));
} catch (e) {
  console.log(`(could not parse ${file}: ${e.message})`);
  process.exit(0);
}

const failures = [];
for (const suite of report.suites ?? []) collect(suite, failures);

const { expected = 0, unexpected = 0, flaky = 0, skipped = 0 } = report.stats ?? {};

console.log('══════════════════════════════════════════════════════════════');
console.log(` PLAYWRIGHT FAILURE SUMMARY — ${failures.length} failing test(s)`);
console.log(` passed=${expected} failed=${unexpected} flaky=${flaky} skipped=${skipped}`);
console.log('══════════════════════════════════════════════════════════════');

if (failures.length === 0) {
  console.log('(no unexpected failures in the JSON report)');
  process.exit(0);
}

// Group by file so a single broken surface reads as one block, not N entries.
const byFile = new Map();
for (const f of failures) {
  if (!byFile.has(f.file)) byFile.set(f.file, []);
  byFile.get(f.file).push(f);
}

for (const [file, items] of [...byFile.entries()].sort()) {
  console.log(`\n▸ ${file}  (${items.length})`);
  for (const it of items) {
    console.log(`  ✘ [${it.project}] ${file}:${it.line} › ${it.title}`);
    if (it.at) console.log(`      ↳ failed at ${it.at}`);
    console.log(it.error);
  }
}
console.log('\n══════════════════════════════════════════════════════════════');
