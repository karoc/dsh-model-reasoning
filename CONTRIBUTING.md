# Contributing

Thanks for contributing to `dsh-model-reasoning`. This is a small external
plugin, but it is **published to npm and distributed to users** — so releases
must be coherent: a version bump without its documentation is a defect.

## Development

Prerequisites: Node.js ≥ 18, [pnpm](https://pnpm.io).

```sh
pnpm install      # installs build deps (tsdown, react)
pnpm bundle       # emits lib/index.js + lib/client.js
```

- `src/client/` is the browser plugin (slot registration, settings page, styles, locales).
- The client bundle keeps `@deepseek-ai/*` + `react` external (resolved from the
  loader's module table at runtime); everything else is inlined.
- UI must stay aligned with DSH: use `@deepseek-ai/dsh-client-ui-primitives`
  components (`Button`, `Menu`, `Pill`, `Input`, …) and `--dsw-alias-*` tokens.
- Copy is bilingual: add/keep both `en` and `zh` entries in `locales.ts`.

## What every release must contain

A release is ONE coherent change — code and its documentation land together.
Splitting a feature's docs into a later "docs release" is a defect. Every release
MUST include, in the SAME release:

1. **Code change** — implemented, and `pnpm bundle` succeeds (`lib/` produced).
2. **README.md (English)** — describes the new user-visible behavior.
3. **README.zh.md (Chinese)** — mirrors the same sections (same `##` section
   set; the release gate verifies the section counts match).
4. **CHANGELOG.md** — an entry under `## [<version>]` for this release, as the
   latest released entry (Keep a Changelog + SemVer).
5. **Version** — `package.json` version equals the CHANGELOG entry and the git
   tag `v<version>` on HEAD.
6. **Git** — working tree clean (everything committed), tag pushed.
7. **Not re-published** — the version must not already exist on npm.

## Verification — the release gate

The gate is **automated and blocking**: `scripts/release-check.mjs` checks every
item above and exits non-zero if any is missing. It runs:

- standalone: `pnpm release:check`, and
- **automatically before publish**: `prepublishOnly` runs it first, so
  `npm publish` **cannot proceed until every item passes** ("缺一不可").

It verifies: bilingual READMEs exist and have matching section counts,
CHANGELOG has the current version as the latest entry, version matches
`v<version>` tag on HEAD, working tree is clean, `lib/` is built, and the
version is not already on npm.

## Release steps

```sh
# 1. Make the change and its docs together:
#    code + README.md + README.zh.md + CHANGELOG entry, in one working tree.

# 2. Bump the version, commit, tag, push:
git add -A
git commit -m "chore: bump to <version>"
git tag v<version>
git push origin main
git push origin v<version>

# 3. The gate must pass (it also runs inside prepublishOnly):
pnpm release:check

# 4. Publish (npm auth + OTP):
npm publish
```

If `npm publish` is ever attempted with a missing item, the gate fails loudly
and the publish aborts — fix the item, then re-publish the NEW version.

## Versioning

- Follow [SemVer](https://semver.org/spec/v2.0.0.html).
- Bug fixes → patch (`0.1.x`), features → minor (`0.2.0`).
- The `latest` npm tag follows the highest released version.

## Reporting issues

Open an issue at <https://github.com/karoc/dsh-model-reasoning/issues>.
