/**
 * The "Provider parameters" settings section (external plugin).
 *
 * A companion page to the built-in Models page: it manages the parameters that
 * page deliberately does not expose — per-route retry/backoff policy, timeouts,
 * transport, caching, thinking budgets, capacities, image-payload budgets, and
 * the per-model reasoning-effort declaration. Everything is written into the
 * exact `llm-pi-ai.providers.<route>.*` fields the adapter reads, through the
 * official `settings.mutate` RPC with revision fencing.
 *
 * Route-level fields are enumerated for EVERY provider profile (the installed
 * catalog is not reachable from the client, so a route's catalog MODELS remain
 * read-only here, while its route-level parameters are fully editable).
 *
 * The managed-field registry, validators, and op-diff engine live in
 * {@link ./params.ts}; this file is the shell (route picker, parameter-group
 * tabs, save engine) plus one panel per parameter group.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type {
  IApiClient, SettingsPathOpView, SettingsScope, SettingsScopeSnapshot,
} from '@deepseek-ai/dsh-api-remotes/client'
import { Button, IconChevronDownOutline14, IconThinkOutline16, Input, Menu, Pill, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import {
  BUDGET_KEYS, CACHE_RETENTIONS, EFFECTIVE_DEFAULTS, MODALITIES,
  NUMBER_FIELDS, REASONING_LEVELS, RETRYABLE_CODE_PRESETS, TRANSPORTS,
  buildModelEntry, buildRouteOps, effortStateOf, modelParamsOf, parseNumber,
  paramsDraftOf, stable, validateModelParams, validateParamsDraft, wireOf,
} from './params.ts'
import type {
  FieldIssue, ModelParamsDraft, ParamsDraft, PiAiRoute, PiAiSection, ReasoningLevel,
} from './params.ts'
import type { en, ParamKey } from './locales.ts'

/** Injected dependencies of {@link ProviderParamsSection} (slot `inject` + hooks compartment). */
export interface ProviderParamsInjected {
  /** Settings wire face (namespace mutation carries revision fencing). */
  api: Pick<IApiClient, 'settings'>
  /** Section copy. */
  t: (key: ParamKey) => string
  /** Bare observable bound into the `useModelReasoning` selector hook. */
  hooks: { modelReasoning: SettingsScope<PiAiSection> }
}

/** Props delivered by the slot outlet: the inject face spread flat (hooks bound). */
export interface ProviderParamsProps {
  api?: Pick<IApiClient, 'settings'>
  t?: (key: ParamKey) => string
  useModelReasoning?: (selector: (snapshot: SettingsScopeSnapshot<PiAiSection>) => unknown) => unknown
}

/** Parameter groups, in panel order; ids index the tab strip. The first tab
 * hosts every PER-MODEL editable dimension (input / caps / reasoning); the
 * rest are route-wide because the schema defines those fields once per route. */
const GROUPS = [
  { id: 'permodel', label: 'groupPerModel' },
  { id: 'retry', label: 'groupRetry' },
  { id: 'timeouts', label: 'groupTimeouts' },
  { id: 'cache', label: 'groupCache' },
  { id: 'capacity', label: 'groupCapacity' },
] as const
type GroupId = (typeof GROUPS)[number]['id']

/** Scope statement per group: retry/backoff, timeouts, transport, caching,
 * budgets, and capacities exist ONLY at route level in the llm-pi-ai schema
 * (one value shared by every model); the per-model tab writes into the
 * selected model's own declaration. */
const SCOPE: Record<GroupId, { chip: ParamKey; tip: ParamKey }> = {
  permodel: { chip: 'scopePerModel', tip: 'scopePerModelTip' },
  retry: { chip: 'scopeRoute', tip: 'scopeRouteTip' },
  timeouts: { chip: 'scopeRoute', tip: 'scopeRouteTip' },
  cache: { chip: 'scopeRoute', tip: 'scopeRouteTip' },
  capacity: { chip: 'scopeRoute', tip: 'scopeRouteTip' },
}

/** How one model's reasoning editor is currently set. */
type EffortMode = 'inherit' | 'off' | 'on'

/** Which dimensions "apply to all models" copies from the editor. */
type ApplyAspects = { input: boolean; capacity: boolean; reasoning: boolean }

/** The aspect checkboxes, in display order. */
const ASPECTS: ReadonlyArray<{ id: keyof ApplyAspects; label: ParamKey }> = [
  { id: 'input', label: 'applyAspectInput' },
  { id: 'capacity', label: 'applyAspectCapacity' },
  { id: 'reasoning', label: 'applyAspectReasoning' },
]

/**
 * One-control searchable select: the trigger pill opens a panel whose FIRST
 * element is the filter input — searching never leaves the control. Built on
 * raw elements because ui-primitives' Menu has no content slot for an input,
 * and an <input> inside its row <button> would swallow clicks/focus.
 */
function SearchSelect(props: {
  value: string
  options: ReadonlyArray<{ id: string; label: string }>
  onChange: (id: string) => void
  placeholder: string
  searchPlaceholder: string
  emptyText: string
  disabled?: boolean
}): ReactNode {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent): void => {
      if (!(e.target instanceof Node)) return
      if (rootRef.current?.contains(e.target) === true) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const matched = props.options.find(o => o.id === props.value)
  const needle = query.trim().toLowerCase()
  const shown = needle === ''
    ? props.options
    : props.options.filter(o => o.label.toLowerCase().includes(needle))

  return (
    <div className="mr-sselect" ref={rootRef}>
      <button
        type="button"
        className="mr-selector"
        disabled={props.disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => { setOpen(v => !v); setQuery('') }}
      >
        <span className={matched === undefined ? 'mr-selector-label mr-selector-placeholder' : 'mr-selector-label'}>
          {matched === undefined ? props.placeholder : matched.label}
        </span>
        <IconChevronDownOutline14 className="mr-chevron" />
      </button>
      {open && (
        <div className="mr-sselect-panel" role="listbox">
          <Input
            autoFocus
            className="mr-search"
            value={query}
            placeholder={props.searchPlaceholder}
            onChange={(e) => { setQuery(e.target.value) }}
          />
          <div className="mr-sselect-list">
            {shown.length === 0
              ? <p className="mr-hint">{props.emptyText}</p>
              : shown.map(option => (
                <button
                  key={option.id}
                  type="button"
                  role="option"
                  aria-selected={option.id === props.value}
                  className={`mr-sselect-item${option.id === props.value ? ' mr-sselect-item-active' : ''}`}
                  onClick={() => { props.onChange(option.id); setOpen(false) }}
                >
                  {option.label}
                </button>
              ))}
          </div>
        </div>
      )}
    </div>
  )
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

/** One labeled numeric field; '' renders the effective-default placeholder. */
function NumberField(props: {
  label: string
  tip: string
  value: string
  placeholder: string
  disabled?: boolean
  onChange: (next: string) => void
}): ReactNode {
  return (
    <Tooltip label={props.tip} side="top">
      <label className="mr-numfield">
        <span className="mr-wire-label">{props.label}</span>
        <Input
          className="mr-wire-input"
          value={props.value}
          placeholder={props.value.trim() === '' ? props.placeholder : undefined}
          disabled={props.disabled}
          onChange={(e) => { props.onChange(e.target.value) }}
        />
      </label>
    </Tooltip>
  )
}

/** Default-placeholder text for a numeric field backed by an adapter default. */
function defaultText(t: (key: ParamKey) => string, value: number): string {
  return `${t('effectiveDefault')} ${value}`
}

/**
 * Render the Provider parameters settings page (guarded shell: hooks live in
 * the loaded child, which is only mounted once the slot has injected).
 */
export function ProviderParamsSection(props: ProviderParamsProps): ReactNode {
  const { api, t, useModelReasoning } = props
  if (api === undefined || t === undefined || useModelReasoning === undefined) return null
  return <ProviderParamsLoaded api={api} t={t} useModelReasoning={useModelReasoning} />
}

/** The mounted editor (all hooks run unconditionally here). */
function ProviderParamsLoaded(props: {
  api: Pick<IApiClient, 'settings'>
  t: (key: ParamKey) => string
  useModelReasoning: NonNullable<ProviderParamsProps['useModelReasoning']>
}): ReactNode {
  const { api, t, useModelReasoning } = props

  const raw = useModelReasoning((snapshot) => snapshot) as SettingsScopeSnapshot<PiAiSection>
  const value = raw?.value
  const routes = useMemo(() => Object.entries(value?.providers ?? {}), [value])

  const [routeKey, setRouteKey] = useState<string | undefined>(undefined)
  const [modelIndex, setModelIndex] = useState<number | undefined>(undefined)
  const [mode, setMode] = useState<EffortMode>('inherit')
  const [levels, setLevels] = useState<ReadonlySet<ReasoningLevel>>(new Set(['high']))
  const [wire, setWire] = useState<Record<string, string>>({})
  const [offEmpty, setOffEmpty] = useState(true)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | undefined>(undefined)
  const [saved, setSaved] = useState(false)

  // Route-parameter draft: seeded from the selected route, edited per group.
  const [draft, setDraft] = useState<ParamsDraft>(() => paramsDraftOf(undefined))
  // Per-model draft (input / caps), seeded with the selected model.
  const [modelDraft, setModelDraft] = useState<ModelParamsDraft>(() => modelParamsOf(undefined))
  const [applyAspects, setApplyAspects] = useState<ApplyAspects>({ input: false, capacity: false, reasoning: true })
  const [activeGroup, setActiveGroup] = useState<GroupId>('permodel')
  const [codeInput, setCodeInput] = useState('')

  const activeRoute = routeKey === undefined ? undefined : routes.find(([k]) => k === routeKey)
  const activeRouteKey = activeRoute?.[0]
  const models = activeRoute?.[1]?.models ?? []
  const activeModel = modelIndex === undefined ? undefined : models[modelIndex]

  const pickRoute = (key: string): void => {
    setRouteKey(key)
    setModelIndex(undefined)
    setCodeInput('')
    setSaved(false)
    setFailure(undefined)
    setDraft(paramsDraftOf(routes.find(([k]) => k === key)?.[1]))
  }

  const pickModel = (index: number): void => {
    setModelIndex(index)
    setSaved(false)
    setFailure(undefined)
    const model = models[index]
    const state = effortStateOf(model?.reasoningEfforts)
    setMode(state.kind)
    setModelDraft(modelParamsOf(model))
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

  const patch = (mutate: (current: ParamsDraft) => ParamsDraft): void => {
    setSaved(false)
    setDraft(current => mutate(current))
  }

  /** Tri-state per-model modality toggle: an emptied explicit list clears the
   * key (the host refuses an empty list), back to "inherit". */
  const toggleModelModality = (modality: string): void => {
    setSaved(false)
    setModelDraft((current) => {
      const has = current.inputMods.includes(modality)
      const nextMods = has ? current.inputMods.filter(m => m !== modality) : [...current.inputMods, modality]
      return {
        ...current,
        inputPresent: nextMods.length > 0,
        inputMods: nextMods.length > 0 ? MODALITIES.filter(m => nextMods.includes(m)) : [],
      }
    })
  }

  // A "thinking on" declaration must offer at least one level beyond off, or
  // the adapter refuses it where it is written. The Save gate mirrors that.
  const onHasLevel = levels.size > 0 && (levels.size > 1 || !levels.has('off'))
  const nextDict = mode === 'on'
    ? wireOf(levels, wire, offEmpty)
    : mode === 'off'
      ? false as const
      : undefined
  const effortDirty = activeModel !== undefined
    && stable(activeModel.reasoningEfforts) !== stable(nextDict)

  // Minimal op set for every managed route-level parameter…
  const routeOps = useMemo(
    () => buildRouteOps(activeRoute?.[1], draft),
    [activeRoute, draft],
  )
  // …plus the whole-`models`-array op when the selected model changed: route
  // the entry through buildModelEntry (input / caps drafts), layer the
  // reasoning editor on top, and keep the result only when something actually
  // differs (the host path-op engine cannot address array indices, so the
  // array is the write unit).
  const mergedModel = useMemo(() => {
    if (activeModel === undefined || modelIndex === undefined) return null
    let entry = buildModelEntry(activeModel, modelDraft)
    if (effortDirty) {
      if (nextDict === undefined) {
        const { reasoningEfforts: _dropped, ...rest } = entry
        entry = rest
      } else {
        entry = { ...entry, reasoningEfforts: nextDict }
      }
    }
    return stable(entry) === stable(activeModel) ? null : entry
  }, [activeModel, modelIndex, modelDraft, effortDirty, nextDict])

  const modelOps = useMemo(() => {
    if (mergedModel === null || modelIndex === undefined) return []
    const newModels = models.map((model, i) => (i === modelIndex ? { ...mergedModel } : { ...model }))
    return [{ op: 'set' as const, path: ['providers', activeRouteKey ?? '', 'models'], value: newModels }]
  }, [mergedModel, modelIndex, models, activeRouteKey])

  const issues: FieldIssue[] = useMemo(
    () => [...validateParamsDraft(draft), ...validateModelParams(modelDraft)],
    [draft, modelDraft],
  )
  const canSave = !busy && issues.length === 0 && (routeOps.length > 0 || modelOps.length > 0)

  // Empty-state bookkeeping: while the namespace loads, avoid flashing an empty
  // dropdown; once ready, a page with no providers gets a friendly prompt
  // instead of a dead selector.
  const scopeLoading = raw?.status === 'loading'
  const scopeUnavailable = raw?.status === 'unavailable'
  const showEmpty = raw?.status === 'ready' && routes.length === 0

  // After OUR OWN successful save the snapshot advances; reseed the draft from
  // the stored document exactly once so sparse-vs-stored echoes never read as
  // unsaved edits. External changes do NOT reseed (they surface as conflicts).
  const reseedFrom = useRef<string | null>(null)
  useEffect(() => {
    if (reseedFrom.current === null || raw === undefined) return
    if (`${raw.revision}` === reseedFrom.current) return
    reseedFrom.current = null
    setDraft(paramsDraftOf(routeKey === undefined ? undefined : routes.find(([k]) => k === routeKey)?.[1]))
  }, [raw, routes, routeKey])

  const send = async (ops: SettingsPathOpView[]): Promise<void> => {
    if (api === undefined || activeRouteKey === undefined || ops.length === 0) return
    setBusy(true)
    setFailure(undefined)
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
    reseedFrom.current = `${raw?.revision}`
    setSaved(true)
  }

  const save = (): Promise<void> => send([...routeOps, ...modelOps].map(op => ({ ...op }) as SettingsPathOpView))

  /** Whether the "apply to all models" action is available: a selected model
   * whose editor state is valid, and at least one dimension checked. */
  const canApplyAll = !busy && activeRouteKey !== undefined && modelIndex !== undefined
    && models.length > 0 && (mode !== 'on' || onHasLevel)
    && (applyAspects.input || applyAspects.capacity || applyAspects.reasoning)

  /**
   * Copy the CHECKED dimensions of the current model's editor into every model
   * on the route (the whole `models` array is the write unit). Unchecked
   * dimensions keep each model's own declaration.
   */
  const applyToAll = async (): Promise<void> => {
    if (api === undefined || activeRouteKey === undefined) return
    setBusy(true)
    setFailure(undefined)
    const nextAll = mode === 'on'
      ? wireOf(levels, wire, offEmpty)
      : mode === 'off'
        ? false as const
        : undefined
    const newModels = models.map((model) => {
      let entry: Record<string, unknown> = { ...model }
      if (applyAspects.input) {
        if (modelDraft.inputPresent && modelDraft.inputMods.length > 0) {
          entry.input = MODALITIES.filter(m => modelDraft.inputMods.includes(m))
        } else {
          delete entry.input
        }
      }
      if (applyAspects.capacity) {
        const cw = parseNumber(modelDraft.contextWindow)
        if (modelDraft.contextWindow.trim() !== '' && cw !== undefined) entry.contextWindow = cw
        else delete entry.contextWindow
        const mt = parseNumber(modelDraft.maxTokens)
        if (modelDraft.maxTokens.trim() !== '' && mt !== undefined) entry.maxTokens = mt
        else delete entry.maxTokens
      }
      if (applyAspects.reasoning) {
        if (nextAll === undefined) delete entry.reasoningEfforts
        else entry.reasoningEfforts = nextAll
      }
      return entry
    })
    if (stable(models) === stable(newModels)) {
      setBusy(false)
      return
    }
    await send([{ op: 'set', path: ['providers', activeRouteKey, 'models'], value: newModels }])
  }

  const writable = raw?.writable !== false
  const issueLine = (found: FieldIssue): string => `${t(found.field as ParamKey)} ${t(found.kind as ParamKey)}`

  const renderPerModel = (): ReactNode => (
    <>
      <div className="mr-field">
        <label className="mr-label">{t('routeDefault')}</label>
        <Selector
          value={draft.reasoningDefault}
          placeholder={t('routeDefaultUnset')}
          disabled={!writable}
          options={REASONING_LEVELS.map(level => ({ id: level, label: level }))}
          onChange={(id) => { patch(current => ({ ...current, reasoningDefault: id })) }}
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
              <SearchSelect
                value={modelIndex === undefined ? '' : String(modelIndex)}
                options={models.map((model, index) => ({ id: String(index), label: model.name ?? model.id ?? String(index) }))}
                onChange={(id) => { pickModel(Number(id)) }}
                placeholder={t('modelUnset')}
                searchPlaceholder={t('modelSearchPlaceholder')}
                emptyText={t('modelSearchEmpty')}
                disabled={!writable}
              />
            </div>
          )}

      {activeModel === undefined
        ? null
        : (
          <fieldset className="mr-panel">
            <legend className="mr-panel-title">
              {activeModel.name ?? activeModel.id ?? `#${modelIndex}`}
            </legend>
            <div className="mr-field">
              <Tooltip label={t('modelInputTip')} side="top">
                <span className="mr-label">{t('modelInputLabel')}</span>
              </Tooltip>
              <div className="mr-mode-row">
                {MODALITIES.map(modality => (
                  <label key={modality} className="mr-radio-row">
                    <input
                      type="checkbox"
                      checked={modelDraft.inputMods.includes(modality)}
                      disabled={!writable}
                      onChange={() => { toggleModelModality(modality) }}
                    />
                    {t(`modality_${modality}` as ParamKey)}
                  </label>
                ))}
              </div>
              {!modelDraft.inputPresent ? <div className="mr-wire-title">{t('inheritHint')}</div> : null}
            </div>

            <div className="mr-field">
              <div className="mr-wire-title">{t('modelCapacityTitle')}</div>
              <div className="mr-grid">
                <NumberField
                  label={t('contextWindow')}
                  tip={t('contextWindowTip')}
                  value={modelDraft.contextWindow}
                  placeholder={t('inheritHint')}
                  disabled={!writable}
                  onChange={(next) => { setSaved(false); setModelDraft(c => ({ ...c, contextWindow: next })) }}
                />
                <NumberField
                  label={t('maxTokens')}
                  tip={t('maxTokensTip')}
                  value={modelDraft.maxTokens}
                  placeholder={t('inheritHint')}
                  disabled={!writable}
                  onChange={(next) => { setSaved(false); setModelDraft(c => ({ ...c, maxTokens: next })) }}
                />
              </div>
            </div>

            <div className="mr-wire-title">{t('modelEfforts')}</div>
            <div className="mr-mode-row">
              <Tooltip label={t('modeInheritTip')} side="bottom">
                <label className="mr-radio-row">
                  <input
                    type="radio"
                    name="effort-mode"
                    checked={mode === 'inherit'}
                    disabled={!writable}
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
                    disabled={!writable}
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
                    disabled={!writable}
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
                        disabled={!writable}
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
                                      disabled={!writable}
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
                                        disabled={!writable}
                                        onChange={(e) => { setWire({ ...wire, [level]: e.target.value }); setSaved(false) }}
                                      />
                                    )}
                                </>
                              )
                              : (
                                <Input
                                  className="mr-wire-input"
                                  value={wire[level] ?? level}
                                  disabled={!writable}
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
    </>
  )

  const renderRetry = (): ReactNode => {
    const retry = draft.retry
    const normalDisabled = !writable || retry.mode === 'always'
    const customCodes = retry.codes.filter(code => !(RETRYABLE_CODE_PRESETS as readonly string[]).includes(code))
    const toggleCode = (code: string): void => {
      patch(current => ({
        ...current,
        retry: {
          ...current.retry,
          codes: current.retry.codes.includes(code)
            ? current.retry.codes.filter(c => c !== code)
            : [...current.retry.codes, code],
        },
      }))
    }
    return (
      <>
        <div className="mr-field">
          <label className="mr-label">{t('retryModeLabel')}</label>
          <div className="mr-mode-row">
            <Tooltip label={t('retryModeNormalTip')} side="bottom">
              <label className="mr-radio-row">
                <input
                  type="radio"
                  name="retry-mode"
                  checked={retry.mode === 'normal'}
                  disabled={!writable}
                  onChange={() => { patch(current => ({ ...current, retry: { ...current.retry, mode: 'normal' } })) }}
                />
                {t('retryModeNormal')}
              </label>
            </Tooltip>
            <Tooltip label={t('retryModeAlwaysTip')} side="bottom">
              <label className="mr-radio-row">
                <input
                  type="radio"
                  name="retry-mode"
                  checked={retry.mode === 'always'}
                  disabled={!writable}
                  onChange={() => { patch(current => ({ ...current, retry: { ...current.retry, mode: 'always' } })) }}
                />
                {t('retryModeAlways')}
              </label>
            </Tooltip>
          </div>
        </div>

        <div className="mr-grid">
          <NumberField
            label={t('maxRetries')}
            tip={`${t('maxRetriesTip')} · ${defaultText(t, EFFECTIVE_DEFAULTS.retryMaxRetries)}`}
            value={retry.maxRetries}
            placeholder={retry.maxRetries === '' ? defaultText(t, EFFECTIVE_DEFAULTS.retryMaxRetries) : ''}
            disabled={normalDisabled}
            onChange={next => patch(current => ({ ...current, retry: { ...current.retry, maxRetries: next } }))}
          />
        </div>

        <div className={`mr-field${retry.mode === 'always' ? ' mr-dimmed' : ''}`}>
          <label className="mr-label">{t('retryableCodes')}</label>
          <div className="mr-levels">
            {RETRYABLE_CODE_PRESETS.map(code => (
              <Pill
                key={code}
                active={retry.codes.includes(code)}
                disabled={normalDisabled}
                onClick={() => { toggleCode(code) }}
              >
                {code}
              </Pill>
            ))}
            {customCodes.map(code => (
              <Pill key={code} active disabled={normalDisabled} onClick={() => { toggleCode(code) }}>
                {code}
              </Pill>
            ))}
          </div>
          <div className="mr-inline">
            <Input
              className="mr-wire-input"
              value={codeInput}
              placeholder={t('codePlaceholder')}
              disabled={normalDisabled}
              onChange={(e) => { setCodeInput(e.target.value) }}
            />
            <Button
              variant="outline"
              size="sm"
              disabled={normalDisabled || codeInput.trim().length === 0 || retry.codes.includes(codeInput.trim())}
              onClick={() => { toggleCode(codeInput.trim()); setCodeInput('') }}
            >
              {t('addCode')}
            </Button>
          </div>
        </div>

        <fieldset className="mr-panel">
          <legend className="mr-panel-title">{t('backoffTitle')}</legend>
          <div className="mr-grid">
            <NumberField
              label={t('initialDelayMs')}
              tip={`${t('initialDelayMsTip')} · ${defaultText(t, EFFECTIVE_DEFAULTS.retryInitialDelayMs)}`}
              value={retry.initialDelayMs}
              placeholder={defaultText(t, EFFECTIVE_DEFAULTS.retryInitialDelayMs)}
              disabled={!writable}
              onChange={next => patch(current => ({ ...current, retry: { ...current.retry, initialDelayMs: next } }))}
            />
            <NumberField
              label={t('maxDelayMs')}
              tip={`${t('maxDelayMsTip')} · ${defaultText(t, EFFECTIVE_DEFAULTS.retryMaxDelayMs)}`}
              value={retry.maxDelayMs}
              placeholder={defaultText(t, EFFECTIVE_DEFAULTS.retryMaxDelayMs)}
              disabled={!writable}
              onChange={next => patch(current => ({ ...current, retry: { ...current.retry, maxDelayMs: next } }))}
            />
            <NumberField
              label={t('jitterRatio')}
              tip={`${t('jitterRatioTip')} · ${defaultText(t, EFFECTIVE_DEFAULTS.retryJitterRatio)}`}
              value={retry.jitterRatio}
              placeholder={defaultText(t, EFFECTIVE_DEFAULTS.retryJitterRatio)}
              disabled={!writable}
              onChange={next => patch(current => ({ ...current, retry: { ...current.retry, jitterRatio: next } }))}
            />
          </div>
        </fieldset>
      </>
    )
  }

  const renderTimeouts = (): ReactNode => (
    <div className="mr-grid">
      <NumberField
        label={t('timeoutMs')}
        tip={t('timeoutMsTip')}
        value={draft.numbers.timeoutMs}
        placeholder=''
        disabled={!writable}
        onChange={next => patch(current => ({ ...current, numbers: { ...current.numbers, timeoutMs: next } }))}
      />
      <NumberField
        label={t('websocketConnectTimeoutMs')}
        tip={t('websocketConnectTimeoutMsTip')}
        value={draft.numbers.websocketConnectTimeoutMs}
        placeholder=''
        disabled={!writable}
        onChange={next => patch(current => ({ ...current, numbers: { ...current.numbers, websocketConnectTimeoutMs: next } }))}
      />
      <NumberField
        label={t('streamIdleTimeoutMs')}
        tip={`${t('streamIdleTimeoutMsTip')} · ${defaultText(t, EFFECTIVE_DEFAULTS.streamIdleTimeoutMs)}`}
        value={draft.numbers.streamIdleTimeoutMs}
        placeholder={defaultText(t, EFFECTIVE_DEFAULTS.streamIdleTimeoutMs)}
        disabled={!writable}
        onChange={next => patch(current => ({ ...current, numbers: { ...current.numbers, streamIdleTimeoutMs: next } }))}
      />
      <div className="mr-field">
        <label className="mr-label">{t('transport')}</label>
        <Selector
          value={draft.transport}
          placeholder={t('inheritHint')}
          disabled={!writable}
          options={TRANSPORTS.map(v => ({ id: v, label: v }))}
          onChange={(id) => { patch(current => ({ ...current, transport: id })) }}
        />
      </div>
    </div>
  )

  const renderCache = (): ReactNode => (
    <>
      <div className="mr-field">
        <label className="mr-label">{t('cacheRetention')}</label>
        <Selector
          value={draft.cacheRetention}
          placeholder={t('inheritHint')}
          disabled={!writable}
          options={CACHE_RETENTIONS.map(v => ({ id: v, label: v }))}
          onChange={(id) => { patch(current => ({ ...current, cacheRetention: id })) }}
        />
      </div>
      <div className="mr-wire-title">{t('budgetsTitle')}</div>
      <div className="mr-grid">
        {BUDGET_KEYS.map(key => (
          <NumberField
            key={key}
            label={t(`budget_${key}` as ParamKey)}
            tip={t('budgetsTitle')}
            value={draft.budgets[key]}
            placeholder=''
            disabled={!writable}
            onChange={next => patch(current => ({ ...current, budgets: { ...current.budgets, [key]: next } }))}
          />
        ))}
      </div>
    </>
  )

  const renderCapacity = (): ReactNode => {
    const toggleModality = (modality: string): void => {
      patch((current) => {
        const has = current.inputMods.includes(modality)
        const nextMods = has ? current.inputMods.filter(m => m !== modality) : [...current.inputMods, modality]
        return {
          ...current,
          // An emptied explicit list means "no override": the host refuses an
          // empty defaultInput, so clearing the last box clears the key.
          inputPresent: nextMods.length > 0,
          inputMods: nextMods.length > 0
            ? MODALITIES.filter(m => nextMods.includes(m))
            : [],
        }
      })
    }
    const modsActive = new Set(draft.inputMods)
    return (
      <>
        <div className="mr-wire-title">{t('fallbackTitle')}</div>
        <div className="mr-grid">
          <NumberField
            label={t('defaultContextWindow')}
            tip={`${t('defaultContextWindowTip')} · ${defaultText(t, EFFECTIVE_DEFAULTS.defaultContextWindow)}`}
            value={draft.numbers.defaultContextWindow}
            placeholder={defaultText(t, EFFECTIVE_DEFAULTS.defaultContextWindow)}
            disabled={!writable}
            onChange={next => patch(current => ({ ...current, numbers: { ...current.numbers, defaultContextWindow: next } }))}
          />
          <NumberField
            label={t('defaultMaxTokens')}
            tip={`${t('defaultMaxTokensTip')} · ${defaultText(t, EFFECTIVE_DEFAULTS.defaultMaxTokens)}`}
            value={draft.numbers.defaultMaxTokens}
            placeholder={defaultText(t, EFFECTIVE_DEFAULTS.defaultMaxTokens)}
            disabled={!writable}
            onChange={next => patch(current => ({ ...current, numbers: { ...current.numbers, defaultMaxTokens: next } }))}
          />
        </div>
        <div className="mr-field">
          <label className="mr-label">{t('defaultInput')}</label>
          <div className="mr-mode-row">
            {MODALITIES.map(modality => (
              <label key={modality} className="mr-radio-row">
                <input
                  type="checkbox"
                  checked={modsActive.has(modality)}
                  disabled={!writable}
                  onChange={() => { toggleModality(modality) }}
                />
                {t(`modality_${modality}` as ParamKey)}
              </label>
            ))}
          </div>
        </div>
        <div className="mr-wire-title">{t('imageBudgetsTitle')}</div>
        <div className="mr-grid">
          <NumberField
            label={t('maxRequestImageBytes')}
            tip={`${t('maxRequestImageBytesTip')} · ${defaultText(t, EFFECTIVE_DEFAULTS.maxRequestImageBytes)}`}
            value={draft.numbers.maxRequestImageBytes}
            placeholder={defaultText(t, EFFECTIVE_DEFAULTS.maxRequestImageBytes)}
            disabled={!writable}
            onChange={next => patch(current => ({ ...current, numbers: { ...current.numbers, maxRequestImageBytes: next } }))}
          />
          <NumberField
            label={t('requestImagePixelBudget')}
            tip={`${t('requestImagePixelBudgetTip')} · ${defaultText(t, EFFECTIVE_DEFAULTS.requestImagePixelBudget)}`}
            value={draft.numbers.requestImagePixelBudget}
            placeholder={defaultText(t, EFFECTIVE_DEFAULTS.requestImagePixelBudget)}
            disabled={!writable}
            onChange={next => patch(current => ({ ...current, numbers: { ...current.numbers, requestImagePixelBudget: next } }))}
          />
          <NumberField
            label={t('requestImageMaxBytes')}
            tip={`${t('requestImageMaxBytesTip')} · ${defaultText(t, EFFECTIVE_DEFAULTS.requestImageMaxBytes)}`}
            value={draft.numbers.requestImageMaxBytes}
            placeholder={defaultText(t, EFFECTIVE_DEFAULTS.requestImageMaxBytes)}
            disabled={!writable}
            onChange={next => patch(current => ({ ...current, numbers: { ...current.numbers, requestImageMaxBytes: next } }))}
          />
        </div>
      </>
    )
  }

  const panels: Record<GroupId, () => ReactNode> = {
    permodel: renderPerModel,
    retry: renderRetry,
    timeouts: renderTimeouts,
    cache: renderCache,
    capacity: renderCapacity,
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
                <p className="mr-empty-title">{t('emptyNoProvidersTitle')}</p>
                <p className="mr-empty-body">{t('emptyNoProvidersBody')}</p>
                <p className="mr-empty-hint">{t('emptyNoProvidersAction')}</p>
              </div>
            )
            : (
              <>
                <div className="mr-field">
                  <label className="mr-label">{t('routeLabel')}</label>
                  <Selector
                    value={routeKey ?? ''}
                    placeholder={t('routeUnset')}
                    disabled={!writable}
                    options={routes.map(([key, route]) => ({ id: key, label: route?.displayName ?? key }))}
                    onChange={(id) => { pickRoute(id) }}
                  />
                </div>

                {activeRouteKey === undefined
                  ? null
                  : (
                    <>
                      <div className="mr-tabs">
                        {GROUPS.map(group => (
                          <Pill
                            key={group.id}
                            active={activeGroup === group.id}
                            onClick={() => { setActiveGroup(group.id) }}
                          >
                            {t(group.label as ParamKey)}
                          </Pill>
                        ))}
                      </div>
                      <div className="mr-group">
                        <div className="mr-scoperow">
                          <Tooltip label={t(SCOPE[activeGroup].tip)} side="top">
                            <span className="mr-scopechip">{t(SCOPE[activeGroup].chip)}</span>
                          </Tooltip>
                        </div>
                        {panels[activeGroup]()}
                      </div>
                    </>
                  )}

                {issues.length > 0
                  ? <p className="mr-error">{issues.map(issueLine).join(' ')}</p>
                  : null}
                {saved ? <p className="mr-success" role="status">{t('saved')}</p> : null}
                {failure !== undefined ? <p className="mr-error">{failure}</p> : null}

                <div className="mr-actions">
                  {activeModel !== undefined ? (
                    <div className="mr-inline mr-aspects">
                      {ASPECTS.map(aspect => (
                        <label key={aspect.id} className="mr-radio-row">
                          <input
                            type="checkbox"
                            checked={applyAspects[aspect.id]}
                            disabled={busy || !writable}
                            onChange={() => { setApplyAspects(s => ({ ...s, [aspect.id]: !s[aspect.id] })) }}
                          />
                          {t(aspect.label)}
                        </label>
                      ))}
                    </div>
                  ) : null}
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
