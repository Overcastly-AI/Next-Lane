# Releasing Next Lane

The maintainer runbook for publishing a version. One `vX.Y.Z` git tag publishes
**every** artifact; nothing is published by hand.

> **Status, honestly: nothing has been published yet.** This repository has
> **no git tags** and **no `main` branch** — all work lives on a
> `claude/*` working branch. The pipeline below is written, statically
> validated, and dry-runnable, but it has never had a real run. Read
> [First-time setup](#first-time-setup) before the first release.

---

## What a tag publishes

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

- **`.github/workflows/release.yml`** — the only thing that reacts to `v*`
  tags. Everything above happens here.
- **`.github/workflows/images.yml`** — default-branch ("edge") image builds plus
  the web-image CSP smoke test on every branch/PR. It **no longer triggers on
  tags**, deliberately: two workflows racing for the same `latest` tag is a real
  double-publish hazard.
- **`.github/workflows/ci.yml`** — includes a `versions` job that fails if the
  committed versions ever drift apart, so drift is caught on a normal push
  rather than at tag time.

---

## First-time setup

Do these **once**, in order. Steps 1–2 are hard blockers: without them the
release workflow physically cannot fire.

1. **Create a default branch.** GitHub Actions will not run a workflow that
   doesn't exist on a branch, and `images.yml` targets `main`. Decide what
   `main` should be, create it, and make it the repository's default branch.
2. **Push the branch containing this pipeline** so `release.yml` exists in the
   repo's workflow set.
3. **Enable GHCR publishing** (usually already fine): repo →
   Settings → Actions → General → Workflow permissions must allow the
   `GITHUB_TOKEN` to write packages. `release.yml` requests `packages: write`
   per job; nothing else is needed for GHCR or the Helm chart.
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
6. **Dry run it.** Actions → *Release* → *Run workflow* → enter `0.1.0`. This
   runs the version guard, the changelog extraction, the tests, a full
   multi-arch image build, `npm publish --dry-run`, and `helm lint`/`package` —
   and publishes **nothing**. Fix anything red before tagging.

### Secrets summary

| Secret | Required? | Used for |
|---|---|---|
| `GITHUB_TOKEN` | built in, nothing to create | GHCR images, Helm chart, GitHub Release |
| `NPM_TOKEN` | optional | publishing `@next-lane/mcp` |
| `DOCKERHUB_USERNAME` | optional | Docker Hub login |
| `DOCKERHUB_TOKEN` | optional | Docker Hub login |
| `DOCKERHUB_NAMESPACE` | optional | Docker Hub org namespace ≠ username |

Missing optional secrets never fail a release — the pipeline logs a notice and
skips that publisher.

---

## Versioning

- **Lockstep, one number.** A single `vX.Y.Z` tag is the version of
  *everything*: root / `apps/api` / `apps/web` / `apps/mcp` /
  `packages/shared` `package.json`, plus the Helm chart's `version` **and**
  `appVersion`. `scripts/sync-versions.mjs` is the only thing that writes them,
  and `--check` mode (in CI and again in `release.yml`) refuses a tag that
  doesn't match what's committed. Mismatched artifacts cannot ship.
- **Chosen by a human, not computed.** Nothing infers the next number from
  commit messages today. You decide `patch` / `minor` / `major` per SemVer and
  run the sync script.
- **Conventional Commits are enforced** on PR titles (`ci.yml` → `commit-lint`,
  using `scripts/lint-commit-subject.mjs`). That's deliberate groundwork: the
  history already reads `feat(pages): …` / `fix(api): …`, so **semantic-release
  or Changesets can be adopted later without changing how anyone works**.
- **Known future fork.** Lockstep is right while `@next-lane/mcp` only ever
  ships alongside the app. The day the MCP package needs its own cadence — a
  breaking tool-schema change that shouldn't force a major on the whole
  product, or a fix worth publishing between app releases — is the trigger to
  adopt **Changesets** (per-package versions) and retire the lockstep script.
  Until then, one number is simpler and easier to reason about.

**0.x today.** The first release is `0.1.0`, not `1.0.0`: it's the first time
anyone outside the repo can install these artifacts, and the public interfaces
most likely to move under real-world feedback (MCP tool schemas, Helm values,
REST) should be free to change on a minor bump. `1.0.0` is the compatibility
promise — cut it once the published artifacts have been installed and verified
from the outside.

---

## Cutting a release

```bash
# 0. Start from the default branch, fully up to date and green.
git checkout main && git pull

# 1. Update CHANGELOG.md:
#    - move [Unreleased] content into a new "## [X.Y.Z] — YYYY-MM-DD" section
#    - leave [Unreleased] empty
#    - add the link refs at the bottom of the file
$EDITOR CHANGELOG.md

# 2. Set the version everywhere (idempotent; safe to re-run).
node scripts/sync-versions.mjs X.Y.Z
node scripts/sync-versions.mjs --check vX.Y.Z   # what CI will assert

# 3. Sanity-check the release notes that GitHub will show.
node scripts/changelog-extract.mjs X.Y.Z

# 4. Commit, push, and let CI go green BEFORE tagging.
git add -A && git commit -m "chore(release): vX.Y.Z"
git push

# 5. Tag and push the tag — this is what triggers everything.
git tag -a vX.Y.Z -m "vX.Y.Z"
git push origin vX.Y.Z
```

The date in the changelog heading should be the day you actually push the tag.

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

Fastest safe path for a bad release: fix the bug, `node scripts/sync-versions.mjs X.Y.Z+1`,
update the changelog, tag, push. The pipeline handles the rest.

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `✗ Version mismatch — expected X.Y.Z` | The tag doesn't match the committed versions. `node scripts/sync-versions.mjs X.Y.Z`, commit, re-tag. |
| `✗ CHANGELOG.md has no "## [X.Y.Z]" section` | Add the section (see step 1) — the release body comes from it, so an empty release is never published. |
| Docker Hub step says "skipped" | `DOCKERHUB_USERNAME`/`DOCKERHUB_TOKEN` aren't set. Expected and harmless — GHCR still published. |
| npm step says "skipped" | `NPM_TOKEN` isn't set. The package was still built, tested and packed. |
| npm publish fails with 402/403 | The `@next-lane` scope doesn't exist, the token lacks write on it, or the version was already published (npm versions are immutable — bump and re-tag). |
| `helm push` unauthorized | The job needs `packages: write` and the org must allow Actions to write packages. |
| Nothing ran at all on the tag | No default branch, or the workflow file isn't on a branch in the repo. See [First-time setup](#first-time-setup). |
