/**
 * The "Model reasoning" settings section (external plugin).
 *
 * A companion page to the built-in Models page: it lets you configure the
 * per-model reasoning-effort (thinking level) declaration for third-party
 * pi-ai providers, which the built-in Models form deliberately does not expose.
 * It writes the exact same `llm-pi-ai.providers.<route>.models[].reasoningEfforts`
 * (and route-level `reasoning`) fields the adapter reads, so the composer's
 * 「推理等级」 picker and route defaults pick the values up with no other change.
 *
 * Enumerates only routes that carry an explicit `models` list (custom /
 * hand-declared providers) — the installed catalog is not reachable from the
 * client, so catalog-only routes list no models here and keep using the
 * composer picker, which already offers their catalog levels.
 */

import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type {
  IApiClient, SettingsPathOpView, SettingsScope, SettingsScopeSnapshot,
} from '@deepseek-ai/dsh-api-remotes/client'
import { Button, IconChevronDownOutline14, IconThinkOutline16, Input, Menu, Pill, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { en } from './locales.ts'

/** The pi-ai section shapes this page reads and writes (schema-loose on purpose). */
export interface PiAiModel {
  id?: string
  name?: string
  reasoningEfforts?: unknown
}
export interface PiAiRoute {
  displayName?: string
  reasoning?: string
  models?: PiAiModel[]
}
export interface PiAiSection {
  providers?: Record<string, PiAiRoute>
}

/** The pi-ai canonical thinking levels, in escalation order (adapter catalog gate). */
export const REASONING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const
export type ReasoningLevel = (typeof REASONING_LEVELS)[number]

/** How one model's reasoning is currently declared. */
export type EffortState =
  | { kind: 'inherit' }
  | { kind: 'off' }
  | { kind: 'on'; levels: ReadonlySet<ReasoningLevel>; wire?: Record<string, string>; offEmpty?: boolean }

/** Injected dependencies of {@link ReasoningSection} (slot `inject` + hooks compartment). */
export interface ReasoningSectionInjected {
  /** Settings wire face (namespace mutation carries revision fencing). */
  api: Pick<IApiClient, 'settings'>
  /** Section copy. */
  t: (key: keyof typeof en) => string
  /** Bare observable bound into the `useModelReasoning` selector hook. */
  hooks: { modelReasoning: SettingsScope<PiAiSection> }
}

/** Props delivered by the slot outlet: the inject face spread flat (hooks bound). */
export interface ReasoningSectionProps {
  api?: Pick<IApiClient, 'settings'>
  t?: (key: keyof typeof en) => string
  useModelReasoning?: (selector: (snapshot: SettingsScopeSnapshot<PiAiSection>) => unknown) => unknown
}

/** Parse a stored `reasoningEfforts` value into an {@link EffortState}, capturing
 * each declared level's wire spelling and whether `off` sends nothing. */
export function effortStateOf(value: unknown): EffortState {
  if (value === false) return { kind: 'off' }
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const dict = value as Record<string, string | null | undefined>
    const levels = new Set<ReasoningLevel>()
    const wire: Record<string, string> = {}
    let offEmpty = true
    for (const level of REASONING_LEVELS) {
      if (!(level in dict)) continue
      levels.add(level)
      const spelled = dict[level]
      if (level === 'off') {
        offEmpty = spelled === null || spelled === undefined
        if (!offEmpty && typeof spelled === 'string') wire[level] = spelled
      } else if (typeof spelled === 'string') {
        wire[level] = spelled
      }
    }
    return { kind: 'on', levels, wire, offEmpty }
  }
  return { kind: 'inherit' }
}

/** The wire dict a draft produces, or `false` for an explicitly non-reasoning model.
 * Each level sends its custom wire spelling (defaulting to the level name);
 * `off` sends nothing when {@link offEmpty} is true, else its custom value. */
function wireOf(
  levels: ReadonlySet<ReasoningLevel>,
  wire: Record<string, string>,
  offEmpty: boolean,
): Record<string, string | null> {
  const out: Record<string, string | null> = {}
  for (const level of levels) {
    out[level] = level === 'off'
      ? (offEmpty ? null : wire[level] ?? 'off')
      : wire[level] ?? level
  }
  return out
}

/** A General-settings-style dropdown: a selector pill opening a Menu, not a native <select>. */
function Selector(props: {
  value: string
  options: ReadonlyArray<{ id: string; label: string }>
  onChange: (id: string) => void
  placeholder: string
  disabled?: boolean
}): ReactNode {
  const { value, options, onChange, placeholder, disabled } = props
  const [open, setOpen] = useState(false)
  const matched = options.find(o => o.id === value)
  return (
    <Menu
      open={open}
      onClose={() => { setOpen(false) }}
      items={options.map(o => ({ id: o.id, label: o.label }))}
      selectedId={matched === undefined ? undefined : value}
      onSelect={(id) => { onChange(id); setOpen(false) }}
      align="start"
      anchor={(
        <button
          type="button"
          className="mr-selector"
          disabled={disabled}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => { setOpen(v => !v) }}
        >
          <span className={matched === undefined
            ? 'mr-selector-label mr-selector-placeholder'
            : 'mr-selector-label'}
          >
            {matched === undefined ? placeholder : matched.label}
          </span>
          <IconChevronDownOutline14 className="mr-chevron" />
        </button>
      )}
    />
  )
}

/**
 * Render the Model reasoning settings page (guarded shell: hooks live in the
 * loaded child, which is only mounted once the slot has injected).
 * @param props - the inject face.
 * @returns the section, or null while the shell has not injected yet.
 */
export function ReasoningSection(props: ReasoningSectionProps): ReactNode {
  const { api, t, useModelReasoning } = props
  if (api === undefined || t === undefined || useModelReasoning === undefined) return null
  return <ReasoningSectionLoaded api={api} t={t} useModelReasoning={useModelReasoning} />
}

/** The mounted editor (all hooks run unconditionally here). */
function ReasoningSectionLoaded(props: {
  api: Pick<IApiClient, 'settings'>
  t: (key: keyof typeof en) => string
  useModelReasoning: NonNullable<ReasoningSectionProps['useModelReasoning']>
}): ReactNode {
  const { api, t, useModelReasoning } = props

  const raw = useModelReasoning((snapshot) => snapshot) as SettingsScopeSnapshot<PiAiSection>
  const value = raw?.value
  const routes = useMemo(() => Object.entries(value?.providers ?? {}), [value])
  // Only routes carrying an explicit models list can be edited here.
  const editable = routes.filter(([, route]) => Array.isArray(route?.models))

  const [routeKey, setRouteKey] = useState<string | undefined>(undefined)
  const [modelIndex, setModelIndex] = useState<number | undefined>(undefined)
  const [mode, setMode] = useState<EffortState['kind']>('inherit')
  const [levels, setLevels] = useState<ReadonlySet<ReasoningLevel>>(new Set(['high']))
  const [wire, setWire] = useState<Record<string, string>>({})
  const [offEmpty, setOffEmpty] = useState(true)
  const [routeDefault, setRouteDefault] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | undefined>(undefined)
  const [saved, setSaved] = useState(false)

  const activeRoute = routeKey === undefined ? undefined : editable.find(([k]) => k === routeKey)
  const activeRouteKey = activeRoute?.[0]
  const models = activeRoute?.[1]?.models ?? []
  const activeModel = modelIndex === undefined ? undefined : models[modelIndex]
  const activeModelId = activeModel?.id ?? ''

  const pickRoute = (key: string): void => {
    setRouteKey(key)
    setModelIndex(undefined)
    setSaved(false)
    setFailure(undefined)
    // Seed the route-level default selector from the current value.
    const route = editable.find(([k]) => k === key)?.[1]
    setRouteDefault(route?.reasoning ?? '')
  }

  const pickModel = (index: number): void => {
    setModelIndex(index)
    setSaved(false)
    setFailure(undefined)
    const model = models[index]
    const state = effortStateOf(model?.reasoningEfforts)
    setMode(state.kind)
    if (state.kind === 'on') {
      setLevels(state.levels)
      setWire(state.wire ?? {})
      setOffEmpty(state.offEmpty ?? true)
    }
  }

  const toggleLevel = (level: ReasoningLevel): void => {
    setSaved(false)
    setLevels((current) => {
      const next = new Set(current)
      if (!next.delete(level)) next.add(level)
      return next
    })
    // Default a freshly added level's wire spelling to its own name; a deleted
    // level's spelling is harmless to keep (wireOf only reads selected levels).
    setWire((current) => (level in current ? current : { ...current, [level]: level }))
  }

  // A "thinking on" declaration must offer at least one level beyond off, or
  // the adapter refuses it where it is written. The Save gate mirrors that.
  const onHasLevel = levels.size > 0 && (levels.size > 1 || !levels.has('off'))
  const nextDict = mode === 'on'
    ? wireOf(levels, wire, offEmpty)
    : mode === 'off'
      ? false
      : undefined
  const routeDefaultDirty = activeRouteKey !== undefined && routeDefault !== (activeRoute?.[1]?.reasoning ?? '')
  const modelDirty = activeModel !== undefined
    && JSON.stringify(activeModel.reasoningEfforts) !== JSON.stringify(nextDict)
  const canSave = !busy && (mode !== 'on' || onHasLevel) && (routeDefaultDirty || modelDirty)

  // Empty-state bookkeeping: while the namespace loads, avoid flashing an empty
  // dropdown; once ready, a page with no editable routes gets a friendly prompt
  // instead of a dead selector.
  const scopeLoading = raw?.status === 'loading'
  const scopeUnavailable = raw?.status === 'unavailable'
  const showEmpty = raw?.status === 'ready' && editable.length === 0
  const hasAnyProviders = routes.length > 0

  const save = async (): Promise<void> => {
    if (api === undefined || activeRouteKey === undefined) return
    setBusy(true)
    setFailure(undefined)
    const ops: SettingsPathOpView[] = []
    if (activeModel !== undefined && modelIndex !== undefined) {
      const current = activeModel.reasoningEfforts
      const next = mode === 'inherit'
        ? undefined
        : mode === 'off'
          ? false
          : wireOf(levels, wire, offEmpty)
      if (JSON.stringify(current) !== JSON.stringify(next)) {
        // The host path-op engine addresses OBJECT KEYS only: an array segment
        // is not a plain object, so a nested models[i].field path clobbers the
        // whole `models` array into an object (the "expected array" rejection).
        // Like the built-in Models editor, write the entire models array.
        const newModels = models.map((model) => ({ ...model }))
        const entry = newModels[modelIndex]
        if (next === undefined) {
          const { reasoningEfforts: _dropped, ...rest } = entry
          newModels[modelIndex] = rest
        } else {
          newModels[modelIndex] = { ...entry, reasoningEfforts: next }
        }
        ops.push({ op: 'set', path: ['providers', activeRouteKey, 'models'], value: newModels })
      }
    }
    if (activeRouteKey !== undefined) {
      const current = activeRoute?.[1]?.reasoning
      if (routeDefault !== (current ?? '')) {
        if (routeDefault === '') ops.push({ op: 'unset', path: ['providers', activeRouteKey, 'reasoning'] })
        else ops.push({ op: 'set', path: ['providers', activeRouteKey, 'reasoning'], value: routeDefault })
      }
    }
    if (ops.length === 0) {
      setBusy(false)
      return
    }
    const response = await api.settings.mutate({
      ns: 'llm-pi-ai',
      ops,
      ...(raw?.revision === undefined ? {} : { expectedRevision: raw.revision }),
    })
    setBusy(false)
    if (!response.result.ok) {
      setFailure(response.result.error.code === 'settings-conflict'
        ? t('conflict')
        : response.result.error.message)
      return
    }
    setSaved(true)
  }

  /** Whether the "apply to all models" action is available. Requires a selected
   * model (its declaration is what gets copied) plus a valid mode. */
  const canApplyAll = !busy && activeRouteKey !== undefined && modelIndex !== undefined
    && models.length > 0 && (mode !== 'on' || onHasLevel)

  /**
   * Apply the current model's reasoning declaration (inherit / false / levels +
   * wire spellings) to EVERY model on the route, writing the whole models array
   * (path ops cannot address array indices).
   */
  const applyToAll = async (): Promise<void> => {
    if (api === undefined || activeRouteKey === undefined) return
    setBusy(true)
    setFailure(undefined)
    const next = mode === 'inherit'
      ? undefined
      : mode === 'off'
        ? false
        : wireOf(levels, wire, offEmpty)
    const newModels = models.map((model) => {
      const entry = { ...model }
      if (next === undefined) {
        const { reasoningEfforts: _dropped, ...rest } = entry
        return rest
      }
      return { ...entry, reasoningEfforts: next }
    })
    if (JSON.stringify(models) === JSON.stringify(newModels)) {
      setBusy(false)
      return
    }
    const response = await api.settings.mutate({
      ns: 'llm-pi-ai',
      ops: [{ op: 'set', path: ['providers', activeRouteKey, 'models'], value: newModels }],
      ...(raw?.revision === undefined ? {} : { expectedRevision: raw.revision }),
    })
    setBusy(false)
    if (!response.result.ok) {
      setFailure(response.result.error.code === 'settings-conflict'
        ? t('conflict')
        : response.result.error.message)
      return
    }
    setSaved(true)
  }

  return (
    <div className="mr-stack" style={{ padding: '4px 0' }}>
      <h2 className="mr-title">{t('title')}</h2>
      <p className="mr-intro">{t('intro')}</p>
      {raw?.writable === false ? <p className="mr-hint">{t('readOnly')}</p> : null}

      {scopeUnavailable
        ? <p className="mr-hint">{t('unavailable')}</p>
        : scopeLoading
          ? <p className="mr-hint">{t('loading')}</p>
          : showEmpty
            ? (
              <div className="mr-empty" role="status">
                <IconThinkOutline16 className="mr-empty-icon" size={16} />
                {hasAnyProviders
                  ? (
                    <>
                      <p className="mr-empty-title">{t('emptyNoEditableTitle')}</p>
                      <p className="mr-empty-body">{t('emptyNoEditableBody')}</p>
                    </>
                  )
                  : (
                    <>
                      <p className="mr-empty-title">{t('emptyNoProvidersTitle')}</p>
                      <p className="mr-empty-body">{t('emptyNoProvidersBody')}</p>
                      <p className="mr-empty-hint">{t('emptyNoProvidersAction')}</p>
                    </>
                  )}
              </div>
            )
            : (
              <>
              <div className="mr-field">
                <label className="mr-label">{t('routeLabel')}</label>
        <Selector
          value={routeKey ?? ''}
          placeholder={t('routeUnset')}
          disabled={!raw?.writable}
          options={editable.map(([key, route]) => ({ id: key, label: route?.displayName ?? key }))}
          onChange={(id) => { pickRoute(id) }}
        />
      </div>

      {activeRouteKey === undefined
        ? null
        : models.length === 0
          ? (
            <div className="mr-empty mr-model-empty" role="status">
              <p className="mr-empty-title">{t('emptyModelsTitle')}</p>
              <p className="mr-empty-body">{t('emptyModelsBody')}</p>
            </div>
          )
          : (
            <div className="mr-field">
              <label className="mr-label">{t('modelLabel')}</label>
              <Selector
                value={modelIndex === undefined ? '' : String(modelIndex)}
                placeholder={t('modelUnset')}
                disabled={!raw?.writable}
                options={models.map((model, index) => ({ id: String(index), label: model.name ?? model.id ?? String(index) }))}
                onChange={(id) => { pickModel(Number(id)) }}
              />
            </div>
          )}

      {activeRouteKey !== undefined
        ? (
          <fieldset className="mr-panel">
            <legend className="mr-panel-title">{t('routeDefault')}</legend>
            <Selector
              value={routeDefault}
              placeholder={t('routeDefaultUnset')}
              disabled={!raw?.writable}
              options={REASONING_LEVELS.map(level => ({ id: level, label: level }))}
              onChange={(id) => { setRouteDefault(id); setSaved(false) }}
            />
          </fieldset>
        )
        : null}

      {activeModel === undefined
        ? null
        : (
          <fieldset className="mr-panel">
            <legend className="mr-panel-title">
              {`${t('modelEfforts')} — ${activeModel.name ?? activeModel.id ?? modelIndex}`}
            </legend>
            <div className="mr-mode-row">
              <Tooltip label={t('modeInheritTip')} side="bottom">
                <label className="mr-radio-row">
                  <input
                    type="radio"
                    name="effort-mode"
                    checked={mode === 'inherit'}
                    disabled={!raw?.writable}
                    onChange={() => { setMode('inherit'); setSaved(false) }}
                  />
                  {t('modeInheritLabel')}
                </label>
              </Tooltip>
              <Tooltip label={t('modeOffTip')} side="bottom">
                <label className="mr-radio-row">
                  <input
                    type="radio"
                    name="effort-mode"
                    checked={mode === 'off'}
                    disabled={!raw?.writable}
                    onChange={() => { setMode('off'); setSaved(false) }}
                  />
                  {t('modeOffLabel')}
                </label>
              </Tooltip>
              <Tooltip label={t('modeOnTip')} side="bottom">
                <label className="mr-radio-row">
                  <input
                    type="radio"
                    name="effort-mode"
                    checked={mode === 'on'}
                    disabled={!raw?.writable}
                    onChange={() => { setMode('on'); setSaved(false) }}
                  />
                  {t('modeOnLabel')}
                </label>
              </Tooltip>
            </div>
            {mode === 'on'
              ? (
                <>
                  <div className="mr-levels">
                    {REASONING_LEVELS.map(level => (
                      <Pill
                        key={level}
                        active={levels.has(level)}
                        disabled={!raw?.writable}
                        onClick={() => { toggleLevel(level) }}
                      >
                        {level}
                      </Pill>
                    ))}
                  </div>
                  {levels.size > 0
                    ? (
                      <div className="mr-wire">
                        <div className="mr-wire-title">{t('wireTitle')}</div>
                        {REASONING_LEVELS.filter(level => levels.has(level)).map(level => (
                          <div key={level} className="mr-wire-row">
                            <span className="mr-wire-label">{level}</span>
                            {level === 'off'
                              ? (
                                <>
                                  <label className="mr-wire-off">
                                    <input
                                      type="checkbox"
                                      checked={offEmpty}
                                      disabled={!raw?.writable}
                                      onChange={() => { setOffEmpty(v => !v); setSaved(false) }}
                                    />
                                    {t('offEmpty')}
                                  </label>
                                  {offEmpty
                                    ? null
                                    : (
                                      <Input
                                        className="mr-wire-input"
                                        value={wire[level] ?? 'off'}
                                        disabled={!raw?.writable}
                                        onChange={(e) => { setWire({ ...wire, [level]: e.target.value }); setSaved(false) }}
                                      />
                                    )}
                                </>
                              )
                              : (
                                <Input
                                  className="mr-wire-input"
                                  value={wire[level] ?? level}
                                  disabled={!raw?.writable}
                                  onChange={(e) => { setWire({ ...wire, [level]: e.target.value }); setSaved(false) }}
                                />
                              )}
                          </div>
                        ))}
                      </div>
                    )
                    : null}
                </>
              )
              : null}
            {mode === 'on' && !onHasLevel
              ? <p className="mr-error">{t('needLevel')}</p>
              : null}
          </fieldset>
        )}

      {saved ? <p className="mr-success" role="status">{t('saved')}</p> : null}
      {failure !== undefined ? <p className="mr-error">{failure}</p> : null}

      <div className="mr-actions">
        <Button variant="primary" size="md" disabled={!canSave} onClick={() => { void save() }}>
          {t('save')}
        </Button>
        <Tooltip label={t('applyAllTip')} side="top">
          <Button variant="outline" size="md" disabled={!canApplyAll} onClick={() => { void applyToAll() }}>
            {t('applyAll')}
          </Button>
        </Tooltip>
      </div>
              </>
            )}
    </div>
  )
}
