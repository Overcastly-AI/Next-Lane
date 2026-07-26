#!/usr/bin/env node
/**
 * emit-release-outputs.mjs — hand a completed semantic-release run's version to
 * the GitHub Actions job that wraps it.
 *
 * Called by @semantic-release/exec's `publishCmd` (see release.config.mjs),
 * which runs AFTER the `vX.Y.Z` tag has been created and pushed. The job in
 * `.github/workflows/auto-release.yml` reads these outputs to decide whether to
 * call `release.yml` (the publish pipeline) and with which version.
 *
 * Why a script and not `echo … >> $GITHUB_OUTPUT`: the exec plugin runs its
 * command through a lodash template whose `${…}` delimiters collide with shell
 * parameter expansion, so `${GITHUB_OUTPUT:-/dev/null}`-style fallbacks are
 * impossible to write safely. Doing it in node also means a local `semantic-
 * release` run outside CI (no GITHUB_OUTPUT) is a harmless no-op instead of a
 * redirect to an empty filename.
 *
 * Usage:
 *   node scripts/emit-release-outputs.mjs <version> [tag]
 *
 * Writes `released=true`, `version=<version>` and `tag=<tag>` to $GITHUB_OUTPUT.
 * stdout is left EMPTY on purpose — the exec plugin parses a publish command's
 * stdout as a release object.
 */

import { appendFileSync } from 'node:fs';

const [version, tagArg] = process.argv.slice(2);

if (!version) {
  console.error('Usage: node scripts/emit-release-outputs.mjs <version> [tag]');
  process.exit(1);
}

const tag = tagArg || `v${version}`;
const outputs = `released=true\nversion=${version}\ntag=${tag}\n`;

const target = process.env.GITHUB_OUTPUT;
if (target) {
  appendFileSync(target, outputs);
  console.error(`✓ Release outputs written to $GITHUB_OUTPUT: ${version} (${tag})`);
} else {
  console.error(`(not running in GitHub Actions — would have emitted)\n${outputs}`);
}
