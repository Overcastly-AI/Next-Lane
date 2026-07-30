#!/usr/bin/env node
/**
 * sync-versions.mjs — one source of truth for the release version.
 *
 * Next Lane ships several artifacts from one tag (container images, the
 * @next-lane/mcp npm package, the Helm chart, the GitHub release). They must
 * all carry the SAME version, or a `v1.2.3` tag silently produces a 1.2.2 npm
 * package / 0.1.0 chart. This script sets — and, in --check mode, verifies —
 * the version in every place it is recorded.
 *
 * Targets:
 *   package.json                        (root, private)
 *   apps/api/package.json               (private)
 *   apps/web/package.json               (private)
 *   apps/mcp/package.json               (PUBLISHED to npm)
 *   packages/shared/package.json        (private)
 *   deploy/helm/next-lane/Chart.yaml    (version AND appVersion)
 *   deploy/kustomize/base + overlays/prod kustomization.yaml
 *                                       (pinned image newTag; dev tracks latest)
 *
 * Usage:
 *   node scripts/sync-versions.mjs 1.2.3       # write 1.2.3 everywhere (idempotent)
 *   node scripts/sync-versions.mjs --check     # all targets agree? (CI guard)
 *   node scripts/sync-versions.mjs --check v1.2.3
 *                                              # ...and they equal this tag/version
 *   node scripts/sync-versions.mjs --print     # print the current version
 *   node scripts/sync-versions.mjs --files     # list every file it writes
 *
 * A leading "v" is accepted and stripped, so `--check "$GITHUB_REF_NAME"` works
 * directly on a tag name.
 *
 * Exit codes: 0 ok · 1 mismatch/invalid input.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** JSON files whose top-level "version" field we own. */
const PACKAGE_FILES = [
  'package.json',
  'apps/api/package.json',
  'apps/web/package.json',
  'apps/mcp/package.json',
  'packages/shared/package.json',
];

const CHART_FILE = 'deploy/helm/next-lane/Chart.yaml';

// Kustomize overlays that PIN an exact image tag. Left unowned these silently
// rot — both of these sat on a `1.0.0` that was never published, so
// `kubectl apply -k` gave ImagePullBackOff on a release that had shipped fine.
//
// The DEV overlay is deliberately absent: it tracks the mutable `latest` tag
// on purpose, and pinning it would defeat the point.
const KUSTOMIZE_FILES = [
  'deploy/kustomize/base/kustomization.yaml',
  'deploy/kustomize/overlays/prod/kustomization.yaml',
];

// SemVer 2.0.0 (with optional prerelease + build metadata).
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const write = (rel, text) => writeFileSync(join(ROOT, rel), text);

const normalize = (v) => String(v ?? '').trim().replace(/^v/, '');

/**
 * Every pinned `newTag:` in a kustomization, paired with the image it pins.
 * Walks lines tracking the most recent `- name:` rather than regexing the
 * whole `images:` block, so an unrelated `newTag:` elsewhere in the file is
 * still attributed to something readable in --check output.
 */
function readKustomizeTags(rel) {
  const out = [];
  let image = null;
  for (const line of read(rel).split('\n')) {
    const name = line.match(/^\s*-\s*name:\s*(\S+)/);
    if (name) {
      image = name[1];
      continue;
    }
    const tag = line.match(/^\s*newTag:\s*"?([^"\s#]+)"?/);
    if (tag) out.push({ image: image ?? '?', value: tag[1] });
  }
  return out;
}

/** Every place a version lives, as {file, label, value}. */
function readAll() {
  const found = [];

  for (const rel of PACKAGE_FILES) {
    const text = read(rel);
    const m = text.match(/^(\s*)"version"\s*:\s*"([^"]+)"/m);
    if (!m) {
      console.error(`✗ ${rel}: no top-level "version" field found`);
      process.exit(1);
    }
    found.push({ file: rel, label: rel, value: m[2] });
  }

  const chart = read(CHART_FILE);
  for (const key of ['version', 'appVersion']) {
    const m = chart.match(new RegExp(`^${key}:\\s*"?([^"\\s#]+)"?`, 'm'));
    if (!m) {
      console.error(`✗ ${CHART_FILE}: no top-level "${key}:" key found`);
      process.exit(1);
    }
    found.push({ file: CHART_FILE, label: `${CHART_FILE} (${key})`, value: m[1] });
  }

  for (const rel of KUSTOMIZE_FILES) {
    const tags = readKustomizeTags(rel);
    if (!tags.length) {
      console.error(`✗ ${rel}: no pinned "newTag:" found`);
      process.exit(1);
    }
    for (const t of tags) {
      found.push({ file: rel, label: `${rel} (${t.image})`, value: t.value });
    }
  }

  return found;
}

function setVersion(version) {
  let changed = 0;

  for (const rel of PACKAGE_FILES) {
    const text = read(rel);
    // Replace only the FIRST top-level "version" (dependency versions live
    // deeper in the file and must never be touched).
    const next = text.replace(/^(\s*"version"\s*:\s*")([^"]+)(")/m, `$1${version}$3`);
    if (next !== text) {
      write(rel, next);
      console.log(`  updated ${rel}`);
      changed++;
    }
  }

  const chart = read(CHART_FILE);
  // Chart `version` = the chart's own SemVer; `appVersion` = the app it
  // deploys. Next Lane releases them together from one tag, so they match.
  const nextChart = chart
    .replace(/^version:\s*"?[^"\s#]+"?/m, `version: ${version}`)
    .replace(/^appVersion:\s*"?[^"\s#]+"?/m, `appVersion: "${version}"`);
  if (nextChart !== chart) {
    write(CHART_FILE, nextChart);
    console.log(`  updated ${CHART_FILE} (version + appVersion)`);
    changed++;
  }

  for (const rel of KUSTOMIZE_FILES) {
    const text = read(rel);
    // Every pinned tag in these two files is the app version, so rewrite them
    // all. Quote the value: an unquoted `newTag: 1.0` is a YAML float.
    const next = text.replace(/^(\s*newTag:\s*)"?[^"\s#]+"?/gm, `$1"${version}"`);
    if (next !== text) {
      write(rel, next);
      console.log(`  updated ${rel} (image tags)`);
      changed++;
    }
  }

  return changed;
}

function main() {
  const args = process.argv.slice(2);

  if (args.includes('--print')) {
    console.log(readAll()[0].value);
    return;
  }

  // Every file this script WRITES, one per line. release.config.mjs must list
  // all of them in @semantic-release/git `assets`, or a release rewrites a file
  // it never commits and `--check` goes red on the next push. CI asserts that
  // containment against this output rather than trusting the two lists to be
  // kept in sync by hand.
  if (args.includes('--files')) {
    for (const rel of [...PACKAGE_FILES, CHART_FILE, ...KUSTOMIZE_FILES]) console.log(rel);
    return;
  }

  const checkMode = args.includes('--check');
  const positional = args.filter((a) => !a.startsWith('--'));

  if (checkMode) {
    const found = readAll();
    const expected = positional.length ? normalize(positional[0]) : found[0].value;

    if (positional.length && !SEMVER.test(expected)) {
      console.error(`✗ "${positional[0]}" is not a valid SemVer version`);
      process.exit(1);
    }

    const bad = found.filter((f) => f.value !== expected);
    if (bad.length) {
      console.error(
        positional.length
          ? `✗ Version mismatch — expected ${expected} (from "${positional[0]}"):`
          : `✗ Version mismatch — files disagree (using ${expected} from ${found[0].label}):`,
      );
      for (const f of found) {
        console.error(`   ${f.value === expected ? '✓' : '✗'} ${f.label}: ${f.value}`);
      }
      console.error(`\n  Fix with: node scripts/sync-versions.mjs ${expected}`);
      process.exit(1);
    }

    console.log(`✓ All ${found.length} version records agree: ${expected}`);
    for (const f of found) console.log(`   ${f.label}: ${f.value}`);
    return;
  }

  const version = normalize(positional[0]);
  if (!version) {
    console.error(
      'Usage: node scripts/sync-versions.mjs <version> | --check [version] | --print | --files',
    );
    process.exit(1);
  }
  if (!SEMVER.test(version)) {
    console.error(`✗ "${positional[0]}" is not a valid SemVer version (e.g. 1.2.3, 1.2.3-rc.1)`);
    process.exit(1);
  }

  console.log(`Setting version ${version}...`);
  const changed = setVersion(version);
  console.log(changed === 0 ? '  (already in sync — nothing to do)' : `  ${changed} file(s) updated`);

  // Re-read and verify we actually converged (also proves idempotency).
  const found = readAll();
  const bad = found.filter((f) => f.value !== version);
  if (bad.length) {
    console.error('✗ Post-write verification failed:');
    for (const f of bad) console.error(`   ${f.label}: ${f.value}`);
    process.exit(1);
  }
  console.log(`✓ All ${found.length} version records now read ${version}`);
  console.log('\nNext: update CHANGELOG.md, commit, then tag — see RELEASING.md');
}

main();
