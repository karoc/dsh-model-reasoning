/**
 * Design-token styles for the Model reasoning settings section.
 *
 * The plugin is external (not part of the DSH repository), so it cannot import
 * the built-in CSS modules; instead it re-declares the same rules against the
 * shared `--dsw-alias-*` tokens, namespaced under `mr-` to avoid any collision
 * with host styles. Classes mirror the built-in Models form's `.input` /
 * `.selectInput` / label / button styling so the page reads as native DSH UI.
 * Tokens carry no fallback because the host theme always defines them on the
 * app root (exactly as the built-in pages use them).
 */

export const REASONING_STYLES = `
.mr-title { margin: 0 0 4px; font-size: 15px; line-height: 22px; color: var(--dsw-alias-label-primary); }
.mr-intro { margin: 0 0 16px; font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-tertiary); }
.mr-field { margin: 0 0 14px; }
.mr-label { display: block; margin-bottom: 6px; font-size: 13px; line-height: 18px; color: var(--dsw-alias-label-secondary); }
/* Selector pill — the dropdown trigger, matching the General settings rows
   (figma 'Selector': h36 r18, fill --dsw-alias-bg-module-platform, pad 0/14,
   gap 12), which open a Menu rather than a native <select>. */
.mr-selector {
  display: inline-flex; align-items: center; gap: 12px;
  height: 36px; padding: 0 14px; border: none; border-radius: 18px;
  background: var(--dsw-alias-bg-module-platform);
  font: inherit; font-size: 14px; line-height: 22px;
  color: var(--dsw-alias-label-primary); cursor: pointer;
}
.mr-selector:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.mr-selector:disabled { opacity: 0.6; cursor: default; }
.mr-selector-label { white-space: nowrap; }
.mr-selector-placeholder { color: var(--dsw-alias-label-tertiary); }
.mr-chevron { flex: none; }
.mr-panel { border: 1px solid var(--dsw-alias-border-l2); border-radius: 14px; padding: 14px; margin: 0 0 14px; }
.mr-panel-title { margin: 0 0 10px; font-size: 13px; line-height: 18px; color: var(--dsw-alias-label-primary); }
.mr-stack { display: flex; flex-direction: column; gap: 10px; }
.mr-radio-row { display: flex; align-items: flex-start; gap: 8px; font-size: 13px; line-height: 18px; color: var(--dsw-alias-label-primary); cursor: pointer; }
/* The three mode choices laid out side by side. */
.mr-mode-row { display: flex; flex-wrap: wrap; gap: 18px; }
/* A route with an empty models list reuses the empty-placeholder look, lighter. */
.mr-model-empty { padding: 16px 20px; margin-top: 2px; }
.mr-levels { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
/* Native radio themed like DSH's own forms (RiskConfirmation keeps native
   inputs and colors them via accent-color so they follow the theme instead of
   the browser default). */
.mr-radio-row input[type='radio'] {
  accent-color: var(--dsw-alias-button-primary-fill);
}
/* Per-level wire-spelling editor (customizing what each thinking level sends). */
.mr-wire { margin-top: 12px; display: flex; flex-direction: column; gap: 8px; }
.mr-wire-title { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); }
.mr-wire-row { display: flex; align-items: center; gap: 10px; }
.mr-wire-label { min-width: 64px; font-size: 13px; line-height: 18px; color: var(--dsw-alias-label-secondary); }
.mr-wire-off { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); cursor: pointer; }
.mr-wire-off input[type='checkbox'] { accent-color: var(--dsw-alias-button-primary-fill); }
.mr-wire-input { width: 200px; }
/* Model search filter above the model selector; matches the built-in field
   input width so the dropdown sits under a same-sized box. display:flex
   promotes the Input's inline-flex wrap to its own block line — left as an
   inline box it flowed BESIDE the Menu anchor button below it, glued. */
.mr-search { display: flex; width: 280px; margin-bottom: 8px; }
/* Per-group scope badge row: states whether the group is one route-wide value
   or a route default with per-model overrides. */
.mr-scoperow { display: flex; align-items: center; gap: 8px; min-width: 0; }
.mr-scopechip {
  flex: none;
  padding: 2px 10px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 10px;
  background: var(--dsw-alias-bg-module-platform);
  font-size: 12px; line-height: 18px;
  color: var(--dsw-alias-label-secondary);
  white-space: nowrap;
}
.mr-scopetip { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); }
/* Empty state: dashed placeholder box matching the built-in Models form's
   empty catalog (modelEmpty: dashed border-l3, centered, tertiary label). */
.mr-empty {
  display: flex; flex-direction: column; align-items: center; gap: 6px;
  padding: 28px 20px; text-align: center;
  border: 1px dashed var(--dsw-alias-border-l3); border-radius: 8px;
}
.mr-empty-icon { color: var(--dsw-alias-label-tertiary); margin-bottom: 4px; }
.mr-empty-title { margin: 0; font-size: 13px; line-height: 18px; color: var(--dsw-alias-label-primary); }
.mr-empty-body { margin: 0; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); max-width: 320px; }
.mr-empty-hint { margin: 4px 0 0; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); }
.mr-hint { margin: 8px 0 0; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); }
.mr-error { margin: 8px 0 0; font-size: 12px; line-height: 18px; color: var(--dsw-alias-state-error-primary); }
.mr-success { margin: 8px 0 0; font-size: 12px; line-height: 18px; color: var(--dsw-alias-state-success-primary); }
/* Parameter-group tab strip (Pill row) and the active group's body. */
.mr-tabs { display: flex; flex-wrap: wrap; gap: 6px; margin: 2px 0 4px; }
.mr-group { display: flex; flex-direction: column; gap: 12px; }
/* Two-column grid of labeled numeric fields (wraps on narrow panels). */
.mr-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 12px 24px; }
/* Grid items may shrink below content size, so a long field name engages
   ellipsis instead of stretching the cell or wrapping onto a second line —
   a wrapped label pushes its input down and breaks row alignment. */
.mr-grid > * { min-width: 0; }
.mr-numfield { display: flex; flex-direction: column; gap: 4px; cursor: pointer; }
/* Field names stay on ONE line (full descriptions live in the tooltip): a
   two-line label is what used to misalign inputs across a grid row. */
.mr-numfield .mr-wire-label {
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* The Input keeps the primitive's intrinsic ~200px width inside its track —
   stretching it edge-to-edge (width:100%) glued neighboring columns' borders
   together with nothing but the grid gap between them. The unused track tail
   IS the inter-field whitespace, exactly like the built-in forms. */
/* Inline input + button row (custom retryable code entry). */
.mr-inline { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
/* Normal-mode-only controls while Always mode is selected. */
.mr-dimmed { opacity: 0.5; }
.mr-actions { display: flex; gap: 8px; margin-top: 2px; }
`

/**
 * Inject {@link REASONING_STYLES} once, tagged by plugin id so re-evaluation
 * and repeated mounts stay idempotent (mirrors how the loader handles plugin
 * CSS). Called from the client `apply`.
 * @param pluginId - stable plugin id used as the style tag marker.
 */
export function injectReasoningStyles(pluginId: string): void {
  if (typeof document === 'undefined') return
  const selector = `style[data-dsh-plugin-css="${pluginId}"]`
  if (document.querySelector(selector) !== null) return
  const tag = document.createElement('style')
  tag.setAttribute('data-dsh-plugin-css', pluginId)
  tag.textContent = REASONING_STYLES
  document.head.appendChild(tag)
}

// Inject at module evaluation rather than from an `apply` closure. The loader
// executes this factory after the DOM head exists (the same timing the loader
// uses for plugin CSS tags), and a module-top-level call is a preserved side
// effect: the whole module cannot be tree-shaken away leaving a dangling
// reference, which is what a closure-only use allowed rolldown to do.
injectReasoningStyles('dsh-model-reasoning')

