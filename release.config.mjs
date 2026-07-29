/**
 * release.config.mjs — Next Lane's automatic release brain.
 *
 * WHAT THIS DOES (and deliberately does NOT do)
 * ---------------------------------------------
 * `.github/workflows/auto-release.yml` runs semantic-release on every push to
 * `main`. semantic-release ONLY:
 *
 *   1. reads the Conventional Commits since the last `v*` tag,
 *   2. decides the next version (see RELEASE RULES below),
 *   3. writes the new CHANGELOG.md section,
 *   4. runs `scripts/sync-versions.mjs <version>` so all 7 version records
 *      (5 package.json + Helm `version` + Helm `appVersion`) move in lockstep,
 *   5. commits that back to `main` and creates + pushes the `vX.Y.Z` tag.
 *
 * It publishes NOTHING. `.github/workflows/release.yml` still owns every
 * artifact (GHCR/Docker Hub images, `@next-lane/mcp` on npm *with provenance*,
 * the Helm chart, the GitHub Release) and is invoked as a reusable workflow by
 * auto-release.yml once the tag exists. That is why there is no
 * `@semantic-release/npm` and no `@semantic-release/github` in `plugins`.
 *
 * A config file (not `.releaserc.json`) because two things need real code:
 * the multi-line `changelogTitle` and the `headerPartial` that keeps generated
 * sections in Keep a Changelog shape.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)));

// ───────────────────────────── commit types ──────────────────────────────────
// Kept in lockstep with `scripts/lint-commit-subject.mjs` (the CI guard that
// makes sure every commit subject is parseable here). A type that is `hidden`
// never appears in the changelog; a type absent from `releaseRules` below never
// triggers a release.
const types = [
  { type: 'feat', section: 'Features' },
  { type: 'fix', section: 'Bug Fixes' },
  { type: 'perf', section: 'Performance' },
  { type: 'security', section: 'Security' },
  { type: 'revert', section: 'Reverts' },
  { type: 'docs', hidden: true },
  { type: 'refactor', hidden: true },
  { type: 'test', hidden: true },
  { type: 'build', hidden: true },
  { type: 'ci', hidden: true },
  { type: 'chore', hidden: true },
  { type: 'style', hidden: true },
  { type: 'vision', hidden: true },
  { type: 'merge', hidden: true },
];

// ───────────────────────────── release rules ─────────────────────────────────
// Evaluated BEFORE @semantic-release/commit-analyzer's built-in rules; when
// several match one commit the HIGHEST release type wins. Anything not matched
// here falls through to the defaults, which also produce no release for
// docs/chore/ci/style/test/refactor/build.
//
//   feat            -> minor          fix        -> patch
//   perf            -> patch          security   -> patch
//   revert          -> patch          BREAKING   -> minor  (see below)
//   everything else -> no release
//
// ⚠ PRE-1.0 RULE — `{ breaking: true, release: 'minor' }`.
// The default mapping is BREAKING -> major, which from 0.1.x would silently
// publish 1.0.0: an irreversible npm version and a compatibility promise we
// have not made yet. SemVer §4 says anything MAY change while the major is 0,
// so at 0.x a breaking change is a minor bump. This line is what pins that.
//
// WHEN CUTTING 1.0.0: delete this rule (so BREAKING -> major again) and cut the
// 1.0.0 tag by hand via the manual fallback path in RELEASING.md. Automation
// will never move the major version on its own.
const releaseRules = [
  { breaking: true, release: 'minor' },
  { type: 'feat', release: 'minor' },
  { type: 'fix', release: 'patch' },
  { type: 'perf', release: 'patch' },
  { type: 'security', release: 'patch' },
  { revert: true, release: 'patch' },
];

// ─────────────────────────────── changelog ───────────────────────────────────
// @semantic-release/changelog inserts each new section directly AFTER this
// exact prefix of CHANGELOG.md (it does a literal `startsWith`). If the two
// ever drift, the plugin would silently prepend a SECOND copy of the header —
// so the mismatch is a hard error here instead, and it fires during the CI dry
// run long before a real release.
const changelogTitle = `# Changelog

All notable changes to Next Lane are documented here.
Next Lane is built and maintained by [Overcastly AI](https://overcastly.com).

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Next Lane uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

_Releases are automatic — every merge to \`main\` that contains a \`feat:\` or
\`fix:\` commit publishes a version and writes its section below. Nothing is
staged here by hand (see [\`RELEASING.md\`](./RELEASING.md))._

---`;

const changelogFile = 'CHANGELOG.md';
const currentChangelog = readFileSync(join(ROOT, changelogFile), 'utf8').trim();
if (!currentChangelog.startsWith(changelogTitle)) {
  throw new Error(
    `${changelogFile} no longer starts with the \`changelogTitle\` pinned in release.config.mjs.\n` +
      'Update the template literal in release.config.mjs to match the new preamble\n' +
      '(everything above the newest "## [x.y.z]" section), or revert the preamble edit.\n' +
      'Left unfixed, @semantic-release/changelog would duplicate the file header.',
  );
}

/**
 * Keep a Changelog section heading: `## [1.2.3] — 2026-07-26`.
 *
 * NOT cosmetic. `scripts/changelog-extract.mjs` (which produces the GitHub
 * Release body) matches `^##\s+\[?<version>\]?(\s|$)`, and the preset's default
 * heading — `# [1.2.3](https://…/compare/…) (2026-07-26)` — matches neither the
 * level nor the shape. The compare link moves to its own line underneath.
 */
function headerPartial(context) {
  const { version, date, linkCompare, previousTag, currentTag, host, owner, repository } = context;
  const heading = `## [${version}] — ${date}`;

  // The trailing newline is the blank line before the first `### …` group.
  if (!linkCompare || !host || !owner || !repository) return `${heading}\n`;
  return `${heading}\n\n[Compare with ${previousTag}](${host}/${owner}/${repository}/compare/${previousTag}...${currentTag})\n`;
}

export default {
  branches: ['main'],
  tagFormat: 'v${version}',
  plugins: [
    ['@semantic-release/commit-analyzer', { preset: 'conventionalcommits', presetConfig: { types }, releaseRules }],
    ['@semantic-release/release-notes-generator', { preset: 'conventionalcommits', presetConfig: { types }, writerOpts: { headerPartial } }],
    [
      '@semantic-release/changelog',
      { changelogFile, changelogTitle },
    ],
    [
      '@semantic-release/exec',
      {
        // THE version bump. One script owns all 7 records — never hand-edit.
        prepareCmd: 'node scripts/sync-versions.mjs ${nextRelease.version}',
        // Runs after the tag has been created and pushed; hands the version to
        // the workflow so it can call release.yml.
        publishCmd: 'node scripts/emit-release-outputs.mjs ${nextRelease.version} ${nextRelease.gitTag}',
      },
    ],
    [
      '@semantic-release/git',
      {
        assets: [
          'CHANGELOG.md',
          'package.json',
          'apps/api/package.json',
          'apps/web/package.json',
          'apps/mcp/package.json',
          'packages/shared/package.json',
          'deploy/helm/next-lane/Chart.yaml',
        ],
        // `[skip ci]` is belt-and-braces against a release loop: the push is
        // made with GITHUB_TOKEN, which by design cannot trigger workflows at
        // all. See auto-release.yml for the full explanation.
        message: 'chore(release): v${nextRelease.version} [skip ci]',
      },
    ],
  ],
};
