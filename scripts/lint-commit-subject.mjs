#!/usr/bin/env node
/**
 * lint-commit-subject.mjs — Conventional Commits check for PR titles / commits.
 *
 * Why: the repo's history already follows Conventional Commits
 * (`feat(pages):`, `fix(api):`, `docs(audit):`, `vision:`). Enforcing it keeps
 * the door open to automated versioning later (semantic-release / Changesets)
 * without changing conventions — see RELEASING.md § Versioning. Today the
 * version number is still chosen by a human; this only guards the format.
 *
 * The ALLOWED types are taken from what this repo actually uses — a histogram
 * of the type prefix in `git log --format=%s` — not from an idealized list
 * that would reject our own history.
 *
 * Usage:
 *   node scripts/lint-commit-subject.mjs "feat(pages): add graph view"
 *   node scripts/lint-commit-subject.mjs --stdin < subjects.txt
 *   printf '%s\n' "$PR_TITLE" | node scripts/lint-commit-subject.mjs --stdin
 *
 * Exit 0 = every subject is valid · exit 1 = at least one is not.
 * Zero dependencies and no install — it must stay cheap enough to run on
 * every PR without touching the main build lane.
 */

import { readFileSync } from 'node:fs';

const TYPES = [
  'feat', // new user-facing capability            -> minor bump
  'fix', // bug fix                                -> patch bump
  'docs', // documentation / roadmap / backlog
  'refactor', // behaviour-preserving code change
  'perf', // performance work
  'test', // tests only
  'build', // build system, Dockerfiles, deps
  'ci', // workflows / pipelines
  'chore', // maintenance that fits nowhere else
  'revert', // revert of a previous change
  'style', // formatting / visual polish, no logic
  'security', // security hardening
  'vision', // founder-vision docs (vision-steward agent)
  'merge', // integration commit for a completed branch
];

// type(optional-scope)(optional !): subject
const RE = new RegExp(`^(${TYPES.join('|')})(\\([a-z0-9 ,._/-]+\\))?(!)?: .+`);

// Git's own auto-generated subjects are never Conventional Commits and are not
// something a contributor writes — never fail on them.
const IGNORE =
  /^(Merge (branch|pull request|remote-tracking)|Revert ")|^(Bump|Update) .+ from .+ to .+$/;

// Subject length is a STYLE preference, not a machine-readable contract, and
// this repo legitimately writes long descriptive subjects — so it warns, it
// never fails. Only the parseable `type(scope): description` shape is enforced.
const SOFT_MAX = 100;

function check(subject) {
  const s = subject.trim();
  if (!s) return null;
  if (IGNORE.test(s)) return null;
  if (RE.test(s)) return null;
  return 'does not match Conventional Commits';
}

const args = process.argv.slice(2);
const subjects = args.includes('--stdin')
  ? readFileSync(0, 'utf8').split('\n')
  : args.filter((a) => !a.startsWith('--'));

if (!subjects.length) {
  console.error('Usage: node scripts/lint-commit-subject.mjs "<subject>" | --stdin');
  process.exit(1);
}

const failures = [];
let checked = 0;
let long = 0;
for (const s of subjects) {
  if (!s.trim()) continue;
  checked++;
  const problem = check(s);
  if (problem) {
    failures.push({ subject: s.trim(), problem });
    continue;
  }
  console.log(`  ✓ ${s.trim()}`);
  if (s.trim().length > SOFT_MAX) {
    long++;
    console.log(`      (note: ${s.trim().length} chars — shorter subjects read better; not an error)`);
  }
}

if (!failures.length) {
  console.log(`\n✓ ${checked} subject(s) follow Conventional Commits.${long ? ` (${long} over ${SOFT_MAX} chars — style note only)` : ''}`);
  process.exit(0);
}

console.error('\n✗ Conventional Commits check failed:\n');
for (const f of failures) {
  console.error(`  ✗ ${f.subject}`);
  console.error(`      ${f.problem}\n`);
}
console.error(`Use:  <type>(<optional scope>): <what changed>

  e.g.  feat(pages): add knowledge-graph view
        fix(api): reject cross-project statusId on issue create
        docs: sync ROADMAP with shipped Pages work
        feat(mcp)!: rename list_issues envelope field (breaking)

Allowed types: ${TYPES.join(', ')}
  · scope is optional, lower-case, in parentheses
  · "!" before the colon marks a breaking change
  · the description follows "': '" (colon + space) and is <100 chars total

Squash-merge makes the PR TITLE the commit message, so the title is what is
checked here. See RELEASING.md § Versioning for why the format matters.`);
process.exit(1);
