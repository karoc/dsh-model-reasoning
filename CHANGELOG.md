# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> **Process rule:** every released version MUST have a matching entry in this
> file AND its user-visible behavior reflected in the README (both `README.md`
> and `README.zh.md`) — all in the same release. The automated gate
> `pnpm release:check` (also run by `prepublishOnly`) blocks publishing until
> every item passes. See [CONTRIBUTING.md](CONTRIBUTING.md).

## [Unreleased]

### Added

- **Model search filter**: a filter input above the model selector narrows a
  long provider model list by name / id as you type. Purely display-level — it
  keeps the stored declaration order and never touches the write path; a query
  that no longer matches the selected model only hides it from the dropdown
  while its editor panel below keeps working.

### Fixed

- **Post-publish check now tolerates registry eventual consistency.** Right
  after upload, `npm view @<version>` can 404 for a few seconds while the index
  catches up, which made `postpublish` falsely report problems for a successful
  publish (and mark the npm command failed). It now polls until the version is
  visible (up to ~42s) before verifying `latest` and the tarball, and only
  reports an error when the version genuinely never appears.

## [0.1.4] - 2026-08-16

### Added

- **Apply to all models**: an action next to Save copies the current model's
  thinking declaration (inherit / non-reasoning / levels + wire spellings) to
  every model on the route at once. It stays disabled until a model is
  selected, so it never applies an uninitialized (default-inherit) state.
- **Mode choices in a row with tooltips**: the three modes (inherit /
  non-reasoning / reasoning) now sit side by side; hover shows an explanation
  via the DSH `Tooltip` component (no native `title`).
- **Empty-models guidance**: selecting a provider that has no models shows a
  friendly prompt (mirroring the empty-provider state) instead of an empty
  dropdown.
- **Automated release gate** (`scripts/release-check.mjs`, `pnpm release:check`):
  verifies bilingual README section/subsection parity, non-empty CHANGELOG
  entry, version/tag match on HEAD, clean working tree, fresh build output
  (`src/` not newer than `lib/`), and un-published version. Runs in `prepack`
  and `prepublishOnly`, so `npm publish` / `npm pack` are blocked until every
  item passes.
- `CONTRIBUTING.md` documents the mandatory release contents, the gate, its
  documented bypasses (`--ignore-scripts`, content parity), and the
  post-publish verification step.
- **Post-publish verification** (`scripts/post-publish-check.mjs`, `postpublish`):
  after the package is uploaded, confirms `dist-tags.latest` matches the
  released version and the published tarball contains every expected file;
  reports loud, unambiguous findings if not (it cannot prevent a bad publish —
  it confirms and alarms afterwards).

## [0.1.3] - 2026-08-15

### Added

- Friendly **empty state** when no third-party provider is configured yet:
  instead of a dead empty dropdown, a placeholder card (dashed border, brain
  icon) prompts the user to add a custom provider first, pointing at
  **Settings → Models → Add a custom provider**.
  - Distinguishes "no providers at all" from "providers without a custom
    `models` list".
  - Shows loading / unavailable hints while the settings document loads.

## [0.1.2] - 2026-08-15

### Added

- **Simplified Chinese README** (`README.zh.md`), shipped in the npm package.

## [0.1.1] - 2026-08-15

### Added

- npm badges and **install / update / remove** instructions in the README.

## [0.1.0] - 2026-08-15

### Added

- Initial release: external DeepSeek Harness web client plugin.
  - New Settings section **「模型思考等级 / Model reasoning」** to configure
    per-model reasoning efforts for third-party (pi-ai) providers.
  - Per-model thinking levels (`reasoningEfforts`): inherit / non-reasoning /
    reasoning with a level set (`off minimal low medium high xhigh max`).
  - **Custom wire spelling** per level (e.g. `max → ultra`), incl. `off`
    empty-or-custom value, to adapt to any upstream vocabulary.
  - Route default thinking level (`providers.<route>.reasoning`).
  - Writes through the official `settings.mutate` RPC with revision fencing.
  - Design-token UI aligned with DSH (`--dsw-alias-*`, ui-primitives
    components).
  - MIT licensed; published to npm and GitHub.
