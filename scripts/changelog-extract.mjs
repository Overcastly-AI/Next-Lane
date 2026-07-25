#!/usr/bin/env node
/**
 * changelog-extract.mjs — pull one release's notes out of CHANGELOG.md.
 *
 * The GitHub release body is NOT hand-written at tag time: it is the matching
 * `## [<version>]` section of CHANGELOG.md, so the changelog stays the single
 * narrative of what shipped. If the tag has no section, this exits 1 with a
 * clear message and the release workflow fails loudly (better than publishing
 * a release with empty notes).
 *
 * Usage:
 *   node scripts/changelog-extract.mjs 1.2.3        # prints the section body
 *   node scripts/changelog-extract.mjs v1.2.3       # leading "v" is fine
 *   node scripts/changelog-extract.mjs 1.2.3 --out notes.md
 *
 * Matches headings of the form:
 *   ## [1.2.3] - 2026-07-18   |   ## [1.2.3] — 2026-07-18   |   ## [1.2.3]
 *   ## 1.2.3 - 2026-07-18     (unbracketed also accepted)
 */

import { readFileSync, writeFileSync } from 'node:fs';

// Piping into `head` closes stdout early — that's not an error worth a stack trace.
process.stdout.on('error', () => process.exit(0));
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHANGELOG = join(ROOT, 'CHANGELOG.md');

const args = process.argv.slice(2);
const outIdx = args.indexOf('--out');
const outFile = outIdx === -1 ? null : args[outIdx + 1];
// Positional = anything that is neither a flag nor a flag's value.
const raw = args.filter((a, i) => !a.startsWith('--') && !(outIdx !== -1 && i === outIdx + 1))[0];

if (!raw) {
  console.error('Usage: node scripts/changelog-extract.mjs <version> [--out FILE]');
  process.exit(1);
}

const version = raw.trim().replace(/^v/, '');
const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const text = readFileSync(CHANGELOG, 'utf8');
const lines = text.split('\n');

const headingRe = new RegExp(`^##\\s+\\[?${escaped}\\]?(\\s|$)`);
const anyHeadingRe = /^##\s+/;

const start = lines.findIndex((l) => headingRe.test(l));
if (start === -1) {
  const known = lines
    .filter((l) => anyHeadingRe.test(l))
    .map((l) => l.replace(/^##\s+/, '').trim())
    .slice(0, 10);
  console.error(
    `✗ CHANGELOG.md has no "## [${version}]" section.\n` +
      `  Add one (move the [Unreleased] content into it) before tagging v${version}.\n` +
      `  Sections found: ${known.length ? known.join(', ') : '(none)'}`,
  );
  process.exit(1);
}

let end = lines.length;
for (let i = start + 1; i < lines.length; i++) {
  if (anyHeadingRe.test(lines[i])) {
    end = i;
    break;
  }
}

// Trim the trailing "---" separator and surrounding blank lines the file uses
// between sections, plus any reference-link block that trailed the section.
const body = lines
  .slice(start + 1, end)
  .join('\n')
  .replace(/\n+---\s*$/, '')
  .replace(/(\n\[[^\]]+\]:\s*\S+)+\s*$/, '')
  .trim();

if (!body) {
  console.error(`✗ The "## [${version}]" section in CHANGELOG.md is empty.`);
  process.exit(1);
}

if (outFile) {
  writeFileSync(outFile, body + '\n');
  console.error(`✓ Wrote ${body.length} bytes of release notes for ${version} to ${outFile}`);
} else {
  process.stdout.write(body + '\n');
}
