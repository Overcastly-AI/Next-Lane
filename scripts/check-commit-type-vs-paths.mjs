#!/usr/bin/env node
/**
 * Fail when a commit's conventional-commit TYPE contradicts the files it
 * actually touches.
 *
 * Why: `1c23627` landed **544 files under apps/{web,api}/src** (200,748
 * insertions) under the subject `docs: docs-site — Gitea, NLQL fail-loud,
 * dashboard share links`. Nothing in the log said the app had changed, and
 * the e2e suite went red for 25 days before anyone noticed.
 *
 * That was already bad. Once `auto-release.yml` is live it gets worse:
 * semantic-release maps `docs:`/`chore:`/`ci:`/`test:`/`style:` to NO RELEASE.
 * So a mislabelled commit ships app code to `main` and publishes **nothing** —
 * no version bump, no changelog entry, no images — and every self-hosted
 * install silently diverges from the source it claims to be.
 *
 * `lint-commit-subject.mjs` validates the FORMAT of a subject. It cannot know
 * whether the type is TRUE. This checks the claim against the diff.
 *
 * Usage: node scripts/check-commit-type-vs-paths.mjs <base-ref> <head-ref>
 */
import { execFileSync } from 'node:child_process';

/** Types that semantic-release treats as "no user-facing change". */
const NO_RELEASE_TYPES = new Set(['docs', 'chore', 'ci', 'test', 'style']);

/**
 * Paths that DO change the shipped product. Deliberately narrow: test files
 * and stories under these trees are legitimately `test:`/`chore:`, so they are
 * excluded below rather than being flagged.
 */
const PRODUCT_PATH = /^(apps\/(api|web|mcp)\/src\/|packages\/shared\/src\/|apps\/api\/prisma\/)/;
const NOT_PRODUCT = /(\.spec\.[jt]sx?|\.test\.[jt]sx?|\.stories\.[jt]sx?)$/;

/**
 * Files that sit under a product tree but are not the product.
 *
 * Listed by exact path, not by pattern, on purpose. `apps/api/prisma/` is in
 * PRODUCT_PATH because the schema, the migrations and `seed.ts` all genuinely
 * ship — `pnpm db:seed` is a documented user command, so a `docs:` commit that
 * changes it must still be blocked. A loose `seed-*.ts` rule would punch a hole
 * big enough to drive that through.
 *
 * `seed-screenshots.ts` is documentation tooling that happens to need Prisma:
 * it stages the demo workspace the screenshots are photographed from. Nothing
 * imports it, no package.json script runs it, it is not in the image's runtime
 * path, and its only references are the capture harness and
 * docs/screenshots/README.md. It cannot make an install diverge from its
 * source, which is the entire hazard this guard exists to catch. Its other
 * half, `apps/web/e2e/screenshots.capture.ts`, is already outside PRODUCT_PATH
 * — so without this the same tooling change was blocked on one side of the
 * repo and waved through on the other.
 */
const NOT_PRODUCT_PATHS = new Set(['apps/api/prisma/seed-screenshots.ts']);

const [, , baseRef, headRef] = process.argv;
if (!baseRef || !headRef) {
  console.error('usage: check-commit-type-vs-paths.mjs <base-ref> <head-ref>');
  process.exit(2);
}

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();

let shas = [];
// Same ref twice = "check exactly this one commit". Useful for auditing a
// historical commit whose parent isn't present in a shallow clone.
if (baseRef === headRef) {
  shas = [git('rev-parse', headRef)];
} else
try {
  shas = git('rev-list', `${baseRef}..${headRef}`).split('\n').filter(Boolean);
} catch {
  // Fall back to checking HEAD alone. This happens on a SHALLOW clone, where
  // a commit's object exists but its parent does not, so `base..head` cannot
  // be resolved.
  try {
    shas = [git('rev-parse', headRef)];
    console.error(`note: could not resolve ${baseRef}..${headRef} (shallow clone?) — checking ${headRef} alone`);
  } catch (e2) {
    // Deliberately EXIT 1, not 0. An earlier draft exited 0 here "so a ref
    // problem can't block a PR" — but CI checks out shallow by default, so
    // that would have made this guard silently pass forever. A guard that
    // cannot fail is exactly the failure mode it exists to prevent (cf. the
    // 25-day-red e2e suite). Fix the workflow's fetch-depth instead.
    console.error(`could not resolve any commits from ${baseRef}/${headRef}: ${e2.message}`);
    console.error('If this is CI, set actions/checkout fetch-depth: 0.');
    process.exit(1);
  }
}

const violations = [];

for (const sha of shas) {
  const subject = git('log', '-1', '--format=%s', sha);

  // Ignore auto-generated subjects the lint also ignores.
  if (/^(Merge |Revert |Bump )/.test(subject)) continue;

  const m = /^([a-z]+)(\([^)]*\))?(!)?:/.exec(subject);
  if (!m) continue; // format is lint-commit-subject.mjs's job, not ours
  const [, type, , bang] = m;

  // A `!` is an explicit breaking-change marker — that DOES release.
  if (bang || !NO_RELEASE_TYPES.has(type)) continue;

  const files = git('show', '--name-only', '--format=', sha)
    .split('\n')
    .filter(Boolean)
    .filter(
      (f) =>
        PRODUCT_PATH.test(f) && !NOT_PRODUCT.test(f) && !NOT_PRODUCT_PATHS.has(f),
    );

  if (files.length > 0) {
    violations.push({ sha: sha.slice(0, 7), type, subject, files });
  }
}

if (violations.length === 0) {
  console.log(`✓ ${shas.length} commit(s): no type/paths contradictions.`);
  process.exit(0);
}

console.error('');
console.error('✗ Commit type contradicts the files changed.');
console.error('');
for (const v of violations) {
  console.error(`  ${v.sha}  ${v.subject}`);
  console.error(`      type "${v.type}" means NO RELEASE, but this touches ${v.files.length} product file(s):`);
  for (const f of v.files.slice(0, 10)) console.error(`        ${f}`);
  if (v.files.length > 10) console.error(`        … and ${v.files.length - 10} more`);
  console.error('');
}
console.error('Why this is blocked:');
console.error('  semantic-release treats docs/chore/ci/test/style as "no release", so these');
console.error('  changes would land on main and publish NOTHING — no version bump, no');
console.error('  changelog, no images. Installs would silently diverge from the source.');
console.error('');
console.error('Fix: retype the commit to feat: or fix: (or split the app change out).');
console.error('  git commit --amend    # last commit');
console.error('  git rebase -i <base>  # older commits, use `reword`');
process.exit(1);
