# Releasing Next Lane

**Merge to `main` and everything is taken care of.** You never pick a version,
never edit `CHANGELOG.md`, never push a tag. The version is derived from the
Conventional Commit subjects that CI already enforces.

> **Status, honestly: nothing has been published yet.** This repository has
> **no git tags** and nothing on npm, GHCR or Docker Hub. The pipeline is
> written, statically validated and dry-run-verified, but it has never had a
> real run. **[First release](#first-release-one-time) is a hard prerequisite —
> without the baseline tag the first automatic run would publish `1.0.0`.**

---

## The flow

```
  PR merged to main
        │
        ▼
  auto-release.yml  ─ job "version"
        │   semantic-release reads the commits since the last v* tag
        │   → decides X.Y.Z  → writes the CHANGELOG.md section
        │   → scripts/sync-versions.mjs bumps all 7 version records
        │   → commits "chore(release): vX.Y.Z [skip ci]" to main
        │   → creates + pushes the vX.Y.Z tag
        │
        │   (no releasable commits?  → stops here, green, nothing happens)
        ▼
  auto-release.yml  ─ job "release"
        │   calls release.yml as a REUSABLE workflow (workflow_call)
        ▼
  release.yml  verify → gates → images → npm + helm → github-release
```

`release.yml` is **unchanged in what it does** — it is still the one thing that
publishes. It simply gained a `workflow_call` trigger so the automation can
invoke it directly.

### Why `workflow_call` and not "just push a tag"

A tag or commit pushed with the built-in `GITHUB_TOKEN` **does not trigger any
workflow** — that is GitHub's recursion guard, and it is not configurable. So
the obvious design ("semantic-release pushes `v1.2.3`, `release.yml`'s
`push: tags: ['v*']` trigger fires") would silently publish **nothing** while
every job reported green.

The two ways out are a Personal Access Token (a long-lived, human-owned,
org-wide credential — a bad thing to require of a self-hosted OSS project) or
`workflow_call`. We use `workflow_call`: `release.yml`'s jobs run *inside* the
same run, and `secrets: inherit` carries `NPM_TOKEN` / `DOCKERHUB_*` through
unchanged.

The same guard is what makes a **release loop impossible**: the
`chore(release):` commit that semantic-release pushes to `main` cannot
re-trigger `auto-release.yml`. `[skip ci]` in that commit's subject is a second,
independent layer.

---

## What bumps what

Driven by the commit subject — the **PR title**, since we squash-merge and
`ci.yml`'s `commit-lint` job blocks a PR whose title is not a Conventional
Commit. The mapping lives in `release.config.mjs`.

| Commit type | Bump | In the changelog |
|---|---|---|
| `feat:` | **minor** — `0.1.0` → `0.2.0` | ### Features |
| `fix:` | **patch** — `0.1.0` → `0.1.1` | ### Bug Fixes |
| `perf:` | **patch** | ### Performance |
| `security:` | **patch** | ### Security |
| `revert:` | **patch** | ### Reverts |
| `feat!:` / `fix!:` / `BREAKING CHANGE:` footer | **minor** (see below) | ### ⚠ BREAKING CHANGES |
| `docs:` `refactor:` `test:` `build:` `ci:` `chore:` `style:` `vision:` `merge:` | **none** | hidden |

The highest bump in the batch wins: a merge with two `fix:` and one `feat:`
produces one minor release, not three.

### Breaking changes do NOT bump to 1.0.0 — deliberately

semantic-release's default is `BREAKING CHANGE` → major, which from `0.1.x`
would publish `1.0.0` on the first breaking merge: an npm version that cannot
be unpublished after 72 hours, and a compatibility promise we have not made.

`release.config.mjs` pins `{ breaking: true, release: 'minor' }`, which is what
SemVer §4 prescribes while the major version is 0. **Automation will never move
the major version.** `1.0.0` is cut by a human through the
[manual path](#manual-fallback), and the pinned rule is deleted at the same
time so `BREAKING CHANGE` → major again afterwards. That instruction is written
next to the rule in `release.config.mjs`.

### Forcing or skipping a release

- **Skip:** land the work under a non-releasing type (`docs:`, `chore:`,
  `refactor:`, …). A merge of only those types is a clean no-op — green run, no
  tag, no empty release. Putting `[skip ci]` in the merge commit subject skips
  every workflow, including this one.
- **Force:** there is no "release now" button by design — nothing to release
  means nothing worth publishing. If you genuinely need to republish (e.g. a
  registry outage ate a publish), either land a real `fix:` commit, or use the
  [manual fallback](#manual-fallback) to re-run the publish for an existing tag.
- **Re-run a failed publish:** Actions → *Auto Release* → *Run workflow*. It
  re-runs the same automatic logic; if the tag was already created it is a
  no-op, so use the manual `workflow_dispatch` on *Release* to re-drive
  publishing.

---

## What a release publishes

| # | Artifact | Destination | Requires | If not configured |
|---|----------|-------------|----------|-------------------|
| 1 | `next-lane-api`, `next-lane-web` images (linux/amd64 + arm64) | `ghcr.io/<owner>/next-lane-{api,web}` | built-in `GITHUB_TOKEN` | — always publishes |
| 2 | The same images | `docker.io/<namespace>/next-lane-{api,web}` | `DOCKERHUB_USERNAME` + `DOCKERHUB_TOKEN` secrets | **skipped**, release still succeeds |
| 3 | `@next-lane/mcp` (npm, with [provenance](https://docs.npmjs.com/generating-provenance-statements)) | npmjs.com | `NPM_TOKEN` secret | **skipped** (still built, tested, packed), release still succeeds |
| 4 | `next-lane` Helm chart (OCI) | `oci://ghcr.io/<owner>/charts` | built-in `GITHUB_TOKEN` | — always publishes |
| 5 | GitHub Release (notes = the `CHANGELOG.md` section, chart `.tgz` attached) | this repo | built-in `GITHUB_TOKEN` | — always publishes |

Image tags per release: `X.Y.Z`, `X.Y`, `sha-<short>`, and `latest`
(`latest` is skipped for prereleases like `1.2.3-rc.1`).

**Not published:** `@next-lane/shared` (`private: true`, internal contract
package — keep it that way) and `apps/api` / `apps/web`, which are applications
shipped as container images, not npm packages.

### Which workflow owns what

- **`.github/workflows/auto-release.yml`** — the automation. Runs
  semantic-release on every push to `main`, then calls `release.yml`. Publishes
  nothing itself.
- **`.github/workflows/release.yml`** — the only thing that publishes.
  Three ways in, all converging on one `verify` job that resolves one version
  and one dry-run flag:
  - `workflow_call` — the normal path (from `auto-release.yml`);
  - `push: tags: ['v*']` — a **human-pushed** tag (manual/emergency real release);
  - `workflow_dispatch` — a full **dry run**, publishes nothing.
- **`.github/workflows/images.yml`** — default-branch ("edge") image builds plus
  the web-image CSP smoke test on every branch/PR. It **does not trigger on
  tags**, deliberately: two workflows racing for the same `latest` tag is a real
  double-publish hazard.
- **`.github/workflows/ci.yml`** — `versions` job (all 7 version records agree)
  and `commit-lint` (PR title is a Conventional Commit — the input the whole
  release depends on).

### Source of truth for version numbers

`scripts/sync-versions.mjs` writes **all 7 records** — root / `apps/api` /
`apps/web` / `apps/mcp` / `packages/shared` `package.json`, plus the Helm
chart's `version` **and** `appVersion` — from one number. semantic-release calls
it via `@semantic-release/exec`; `release.yml`'s `verify` job re-checks with
`--check <version>` and refuses to publish mismatched artifacts. Never hand-edit
a version field.

Lockstep is right while `@next-lane/mcp` only ever ships alongside the app. The
day it needs its own cadence, that is the trigger to adopt Changesets and retire
the lockstep script.

---

## ⚠ The consequence to be aware of

**Every merge to `main` containing a `feat:` or `fix:` publishes a new version.**
There is no batching and no approval step. Ten small fixes merged on one
afternoon are ten npm versions, ten image tags and ten GitHub Releases.

That is usually fine — versions are cheap, and users pin what they pin — but it
is **not reversible**: an npm version can only be unpublished within 72 hours,
and never at all once something depends on it. Container tags and OCI charts
should likewise never be deleted from under users.

If the noise becomes a problem, the standard remedy is a **release-PR** tool —
[release-please](https://github.com/googleapis/release-please) accumulates
merges into a single open "chore: release X.Y.Z" pull request, and publishing
happens only when a human merges that PR. It reads the same Conventional
Commits, so switching costs nothing in how anyone works: `auto-release.yml`'s
`version` job is replaced by the release-please action, and the `release` job
(`uses: ./.github/workflows/release.yml`) stays exactly as it is. **Documented
as the escape hatch, not implemented** — batching trades away "merge and it's
done", which is the point of the current setup.

---

## First release (one-time)

Do these **in order**. Steps 1–2 are hard blockers.

1. **Create the baseline tag.** ⚠ **The important one.** semantic-release treats
   "no previous release" as `1.0.0`. This repo sits at `0.1.0` with zero tags,
   so without a baseline the first automatic run would publish **1.0.0**.
   `auto-release.yml` fails fast with this message rather than letting that
   happen — clear it once:

   ```bash
   git checkout main && git pull
   node scripts/sync-versions.mjs --print       # -> 0.1.0
   git tag -a v0.1.0 -m "v0.1.0"                # on the commit that IS 0.1.0
   git push origin v0.1.0
   ```

   > Pushing that tag **by hand** (not with `GITHUB_TOKEN`) *does* trigger
   > `release.yml`, which will publish `0.1.0` for real — images, npm, Helm
   > chart and a GitHub Release. That is intended: `0.1.0` is the release the
   > `CHANGELOG.md` already describes. If you would rather not publish it, tag
   > it locally and push with `--no-verify` after temporarily disabling the
   > *Release* workflow, or accept `0.1.0` as the baseline release.

2. **Let `main` accept the release commit.** `@semantic-release/git` pushes
   `chore(release): vX.Y.Z [skip ci]` straight to `main` using `GITHUB_TOKEN`.
   If `main` has branch protection that requires pull requests or status checks,
   that push is rejected and every release fails. Either leave `main`
   unprotected, or add a bypass for the `github-actions[bot]` actor
   (Settings → Rules/Branch protection → *Bypass list*).
3. **Enable GHCR publishing** (usually already fine): Settings → Actions →
   General → Workflow permissions must allow the `GITHUB_TOKEN` to write
   packages. Both workflows request the permissions they need per job.
4. **Optional — Docker Hub.** Create a Docker Hub account and an *access token*
   (Account Settings → Personal access tokens, Read/Write). Add repo secrets:
   - `DOCKERHUB_USERNAME` — the login user
   - `DOCKERHUB_TOKEN` — the access token (never your password)
   - `DOCKERHUB_NAMESPACE` — *optional*, only if publishing under an org whose
     name differs from the login user; defaults to `DOCKERHUB_USERNAME`.
5. **Optional — npm.** You need an npmjs.com account with publish rights to the
   `@next-lane` scope (create the org/scope first: npmjs.com → Add organization
   → `next-lane`). Generate a **Granular Access Token** with read+write on
   `@next-lane/*` and add it as the `NPM_TOKEN` secret. Provenance requires
   nothing extra — the workflow already requests `id-token: write`.
   > If the `@next-lane` scope is taken by someone else, the package name in
   > `apps/mcp/package.json` must change **before** the first publish; the name
   > is effectively permanent afterwards.
6. **Dry run the publish pipeline.** Actions → *Release* → *Run workflow* →
   enter `0.1.0`. This runs the version guard, the changelog extraction, the
   tests, a full multi-arch image build, `npm publish --dry-run`, and
   `helm lint`/`package` — and publishes **nothing**.

### Secrets summary

| Secret | Required? | Used for |
|---|---|---|
| `GITHUB_TOKEN` | built in, nothing to create | the release commit + tag, GHCR images, Helm chart, GitHub Release |
| `NPM_TOKEN` | optional | publishing `@next-lane/mcp` |
| `DOCKERHUB_USERNAME` | optional | Docker Hub login |
| `DOCKERHUB_TOKEN` | optional | Docker Hub login |
| `DOCKERHUB_NAMESPACE` | optional | Docker Hub org namespace ≠ username |

Missing optional secrets never fail a release — the pipeline logs a notice and
skips that publisher. **No PAT is required anywhere.**

---

## Manual fallback

For emergencies, for `1.0.0`, or for republishing an existing tag. The old
tag-driven path still works exactly as before.

```bash
# Real release from a human-pushed tag (this DOES trigger release.yml).
git checkout main && git pull

# 1. Update CHANGELOG.md by hand: add a "## [X.Y.Z] — YYYY-MM-DD" section
#    directly under the "---" that follows [Unreleased].
$EDITOR CHANGELOG.md

# 2. Set the version everywhere (idempotent; safe to re-run).
node scripts/sync-versions.mjs X.Y.Z
node scripts/sync-versions.mjs --check vX.Y.Z   # what CI will assert

# 3. Sanity-check the release notes GitHub will show.
node scripts/changelog-extract.mjs X.Y.Z

# 4. Commit, push, let CI go green BEFORE tagging.
git add -A && git commit -m "chore(release): vX.Y.Z"
git push

# 5. Tag and push the tag.
git tag -a vX.Y.Z -m "vX.Y.Z"
git push origin vX.Y.Z
```

Because that commit is pushed by a human (not `GITHUB_TOKEN`), the next
`auto-release.yml` run sees `vX.Y.Z` as the new baseline and carries on
automatically from there.

**Dry run anything:** Actions → *Release* → *Run workflow* → a version. Builds,
lints, packs and validates everything; publishes nothing.

**Preview locally what the next version would be:**

```bash
pnpm install
pnpm release:dry-run     # semantic-release --dry-run --no-ci
```

(It only computes a version when run on `main`; on a feature branch it reports
that the branch is not a release branch.)

---

## Verifying a release

```bash
VERSION=X.Y.Z
OWNER=overcastly-ai   # lowercase

# Images
docker pull ghcr.io/$OWNER/next-lane-api:$VERSION
docker pull ghcr.io/$OWNER/next-lane-web:$VERSION
docker buildx imagetools inspect ghcr.io/$OWNER/next-lane-api:$VERSION   # amd64 + arm64?

# npm (if NPM_TOKEN is configured)
npm view @next-lane/mcp version
npx -y @next-lane/mcp@$VERSION --help   # the bin resolves and starts

# Helm chart
helm show chart oci://ghcr.io/$OWNER/charts/next-lane --version $VERSION

# GitHub Release exists with notes + the chart tarball attached
gh release view v$VERSION
```

Then the real test: run the published quickstart end-to-end on a clean host
(`docker compose` with the released image tags), log in, and click through a
board. Publishing is not the same as working.

---

## Rolling back

**Nothing published is ever truly deleted — roll forward wherever possible.**

| Artifact | To undo | Notes |
|---|---|---|
| GHCR / Docker Hub images | Re-tag `latest` to the previous good version, or delete the bad tag in the registry UI | Digests stay pullable; users pinning `X.Y.Z` are unaffected |
| npm `@next-lane/mcp` | `npm deprecate @next-lane/mcp@X.Y.Z "broken, use X.Y.Z-1"` | `npm unpublish` is only allowed within 72h and only if nothing depends on it — prefer deprecate + a patch release |
| Helm chart | Push a fixed patch version | OCI artifacts should not be deleted from under users |
| GitHub Release | `gh release delete vX.Y.Z` (optionally `--cleanup-tag`) | Deleting a tag others have fetched is disruptive; prefer marking it a prerelease and shipping a patch |

Fastest safe path for a bad release: merge the fix as `fix: …`. The next version
publishes itself.

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `✗ No baseline tag` | The repo has no `v*` tag, so the next release would be `1.0.0`. See [First release](#first-release-one-time). |
| `Auto Release` green but nothing published | No `feat:`/`fix:`/`perf:`/`security:`/breaking commit since the last tag — working as designed. The run summary says "No release". |
| Release commit push rejected (`protected branch`) | Branch protection on `main` blocks `github-actions[bot]`. Add a bypass — step 2 of [First release](#first-release-one-time). |
| A hand-pushed tag published nothing | Tags pushed with `GITHUB_TOKEN` never trigger workflows. Push the tag as a human, or use *Release* → *Run workflow*. |
| `CHANGELOG.md no longer starts with the changelogTitle pinned in release.config.mjs` | Someone edited the changelog preamble. Update the `changelogTitle` template literal in `release.config.mjs` to match, or revert the preamble edit. The guard exists because the alternative is a silently duplicated file header. |
| `✗ Version mismatch — expected X.Y.Z` | The tag doesn't match the committed versions (only possible on the manual path). `node scripts/sync-versions.mjs X.Y.Z`, commit, re-tag. |
| `✗ CHANGELOG.md has no "## [X.Y.Z]" section` | Manual path only — add the section before tagging. The release body comes from it, so an empty release is never published. |
| Docker Hub step says "skipped" | `DOCKERHUB_USERNAME`/`DOCKERHUB_TOKEN` aren't set. Expected and harmless — GHCR still published. |
| npm step says "skipped" | `NPM_TOKEN` isn't set. The package was still built, tested and packed. |
| npm publish fails with 402/403 | The `@next-lane` scope doesn't exist, the token lacks write on it, or the version was already published (npm versions are immutable — bump and re-release). |
| `helm push` unauthorized | The job needs `packages: write` and the org must allow Actions to write packages. |
| A breaking change bumped the minor, not the major | Deliberate while we are pre-1.0 — see [Breaking changes](#breaking-changes-do-not-bump-to-100--deliberately). |
