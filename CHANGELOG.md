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

### Fixed

- **Release-tooling probes no longer trust the version endpoint.** The
  registry's `/<pkg>/<version>` endpoint intermittently answers HTTP 406 for
  the abbreviated-metadata accept header even for long-published versions —
  during the 0.2.2 publish it returned 406 for the whole postpublish poll
  window, so a SUCCESSFUL publish was reported as "did not become visible"
  (npm publish exited 1 despite the release being live). Both
  `post-publish-check.mjs` and `release-check.mjs` now probe the FULL package
  document (`/<pkg>`) and judge by the presence of `versions[<version>]`; the
  version endpoint is no longer used. This also closes a latent release-check
  hole: an already-published version could previously be misread as "safe to
  publish" on a 406.

## [0.2.2] - 2026-08-31

### Fixed

- **Adapted to dsh 0.1.2-alpha.2 (the page was empty).** dsh 0.1.2 removed the
  `connection.api` RPC face (`IApiClient`) and the `@deepseek-ai/dsh-client-runtime`
  package; the settings wire is now the generated `ctx.remote.settings` Remote
  namespace (positional `mutate(ns, ops, expectedRevision)`, `RemoteResult`
  settlement, conflict code `settings/conflict`). The plugin injected
  `connection.api` — now `undefined` — so the guarded section rendered `null`
  and Settings → Provider parameters showed an empty page. The section now
  writes through `ctx.remote.settings` (`remote.settings` declared in the fiber
  inject, per the built-in Models page pattern); types moved to their new
  homes (`ClientContext` from `@deepseek-ai/cordis`, `SettingsScope` /
  `SettingsScopeSnapshot` from `@deepseek-ai/dsh-client-ui-settings/client`).
  The `dsh.client.inject` list and tsdown externals drop the removed packages.
- **Route-level saves now reach the adapter (a 0.2.0 regression).** The route
  parameter diff engine emits route-relative op paths, but the section passed
  them to `settings.mutate` unanchored, so every route edit (retry/backoff,
  timeouts, transport, caching, budgets, route reasoning default) was written
  to `llm-pi-ai.<field>` — a location the llm-pi-ai schema does not define —
  and silently never took effect on the adapter. Ops are now anchored under
  `providers.<routeKey>` (`anchoredRouteOps` in `params.ts`, unit-tested);
  per-model ops already were.

## [0.2.1] - 2026-08-24

### Fixed

- **Publish lifecycle output no longer sprays `npm error E404` blocks.**
  Registry probes in `release-check.mjs` (step 8) and `post-publish-check.mjs`
  (visibility polling, dist-tags, tarball URL) used the npm CLI, which prints a
  9-line E404 error block on every miss — twice before upload and once per poll
  after it — so a SUCCESSFUL publish showed 「满屏错误 + ✅」. Both scripts now
  query the registry index directly with the built-in `fetch`: only HTTP 200
  means "already published"; the gate prints `is NOT published yet — safe to
  publish` / `registry unreachable`, and postpublish polling prints one
  progress line per retry (`not visible yet — index catching up; retry N/14`).
  Side benefit: no npm subprocess means no stray `~/.npm` log writes. Same
  remedy as prescribed by the dsh-plugin-development skill §6 (dsh-kanban
  0.2.0 precedent).

## [0.2.0] - 2026-08-17

### Added

- **The page is now a provider-parameter manager** (renamed 「提供方参数 /
  Provider parameters」, section id `provider-params`). Beyond the existing
  per-model reasoning editor, it manages every route-level parameter the
  built-in Models page does not expose, for EVERY `llm-pi-ai` provider route
  (catalog routes included):
  - **Retry & backoff** (`retryPolicy`): mode `normal`/`always`, `maxRetries`,
    `retryableCodes` (five stable preset codes + custom entries), and the
    shared exponential backoff (`initialDelayMs`, `maxDelayMs`, `jitterRatio`);
    an all-defaults normal policy collapses back to unset, and switching modes
    rewrites the subtree so inactive fields never linger.
  - **Timeouts & transport**: `timeoutMs`, `websocketConnectTimeoutMs`,
    `streamIdleTimeoutMs`, `transport`.
  - **Caching & thinking budgets**: `cacheRetention`,
    `thinkingBudgets.{minimal,low,medium,high}`.
  - **Capacities & request budgets**: `defaultContextWindow`,
    `defaultMaxTokens`, `defaultInput` (`text/image`),
    `maxRequestImageBytes`, `requestImagePixelBudget`,
    `requestImageMaxBytes`.
- **Per-model capability editing** — the first tab, 「按模型 / Per model」, edits
  the SELECTED model's own declaration instead of a route-wide echo: input
  modalities (`input`: `text`/`image`, tri-state — an emptied list clears the
  key back to inherit), context/output caps (`contextWindow`, `maxTokens`),
  and the full reasoning editor (inherit / non-reasoning / levels + wire
  spelling). A mixed text-only + vision provider therefore declares each
  model's real modality set instead of one route-wide guess. **Apply to all
  models** copies only the CHECKED dimensions (modalities / caps / reasoning)
  from the editor to every model on the route.
- Effective adapter defaults render as placeholders while a field is unset;
  clearing a field removes the override instead of echoing the default.
- Local validation mirrors the host's resolution rules (retry bounds, timer
  ceiling, positive-integer capacities, jitter ratio, non-empty modality list),
  blocking the save before the RPC; host-side `settings-rejected` messages are
  surfaced verbatim.
- A parameter registry (`src/client/params.ts`) now owns value domains,
  defaults, validators, and the minimal-op diff engine — scalar overrides write
  precise `set`/`unset` paths while composites and the `models` array write
  whole keys. After this plugin's own save succeeds, the draft reseeds from the
  stored document exactly once so server echoes never read as unsaved edits.
- Unit tests for the registry (`npm test`, node:test running TypeScript
  directly) pinning validation rules and op-diff behavior.
- **Scope badges**: every parameter-group panel opens with a badge stating its
  scope — 「按模型 / Per model」 (written into the selected model's declaration;
  unset dimensions inherit route fallbacks or catalog values) vs 「整条路由 /
  Whole route」, whose hover tooltip explains that those fields exist ONLY at
  route level in the llm-pi-ai schema, so one shared value is the whole truth
  rather than a limitation of this UI. The explanation lives in the tooltip
  only, never duplicated as always-visible text beside the chip.

### Changed

- The model search filter ships in this release (developed post-0.1.4): a
  display-only filter above the model selector narrows by name / id, keeping
  the stored order and write path untouched.

### Fixed

- **Grid field labels no longer wrap onto two lines and misalign inputs.**
  Managed-field names render as the bare wire key on a single line (ellipsis
  when space runs out); the full description moved into the hover tooltip via
  dedicated `*Tip` copy keys, and grid items may now shrink so ellipsis engages
  instead of stretching the cell.
- **Grid columns no longer sit glued together.** Managed-field inputs keep the
  Input primitive's intrinsic width inside their track instead of stretching
  edge-to-edge (which left only the raw column gap between the two columns'
  borders), and the column gap widened to 24px.
- **The model picker fuses search into the dropdown.** The per-model selector
  is a dedicated searchable listbox — the filter is the panel's first element,
  so there is no separate search box beside or above the trigger
  (ui-primitives' Menu has no content slot for an input, hence the small
  purpose-built panel with outside-click and Escape closing).
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
