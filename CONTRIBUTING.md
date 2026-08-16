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

## Release checklist (mandatory)

Every release MUST complete all of these **before** bumping the version and
publishing. Missing documentation is treated as a release defect:

1. **Code change** — implement the feature/fix, build it (`pnpm bundle`), and
   verify the client bundle is served correctly.
2. **README — English** (`README.md`): describe any new user-visible behavior
   (features, settings, limitations).
3. **README — Chinese** (`README.zh.md`): mirror the same changes. The two
   files must stay in sync.
4. **CHANGELOG.md**: move/add the entry under the new version, following
   Keep a Changelog + SemVer. The `[Unreleased]` section is for pending work.
5. **Commit + tag + push**:
   ```sh
   git add -A
   git commit -m "chore: bump to <version>"
   git tag v<version>
   git push origin main
   git push origin v<version>
   ```
6. **Publish to npm** (requires npm auth + OTP):
   ```sh
   npm publish
   ```

## Versioning

- Follow [SemVer](https://semver.org/spec/v2.0.0.html).
- Bug fixes → patch (`0.1.x`), features → minor (`0.2.0`).
- The `latest` npm tag follows the highest released version.

## Reporting issues

Open an issue at <https://github.com/karoc/dsh-model-reasoning/issues>.
