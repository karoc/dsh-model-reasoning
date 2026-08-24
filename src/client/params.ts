/**
 * Provider-parameter registry for the settings page (pure logic, no React).
 *
 * One place owns every route-level parameter this plugin manages: the value
 * domains, the effective defaults shown while a field is unset, the local
 * validators that MIRROR the host's own resolution rules (config.ts +
 * retry-policy.ts), and the diff engine that turns a draft into a minimal
 * `settings.mutate` op set. Adding a managed parameter means extending the
 * descriptors here plus copy in locales.ts — the section component stays.
 *
 * Two hard host facts shape this module:
 * - `assertServiceable` runs on every write, refusing an unserviceable profile
 *   with `settings-rejected`. The validators below mirror its rules so the
 *   common mistakes are caught before the RPC round-trip.
 * - The path-op engine addresses object KEYS only (no array indices), so
 *   scalar route fields diff to precise `set`/`unset` ops while composite
 *   values (`retryPolicy`, `thinkingBudgets`, `defaultInput`) and the `models`
 *   array are written whole.
 */

/** The pi-ai canonical thinking levels, in escalation order (adapter catalog gate). */
export const REASONING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const
export type ReasoningLevel = (typeof REASONING_LEVELS)[number]

/** Stable failure codes the adapter classifier emits; the preset checklist for `retryableCodes`. */
export const RETRYABLE_CODE_PRESETS = ['EMPTY_RESPONSE', 'RATE_LIMIT', 'SERVER', 'TIMEOUT', 'TRANSPORT'] as const

/** Streaming transports a route may name (schema union order). */
export const TRANSPORTS = ['auto', 'sse', 'websocket', 'websocket-cached'] as const

/** Prompt-cache retention preferences. */
export const CACHE_RETENTIONS = ['none', 'short', 'long'] as const

/** Every request modality a profile may declare (catalog modality gate). */
export const MODALITIES = ['text', 'image'] as const

/** Thinking-budget tiers (route-level dict consumed by budgeted reasoning providers). */
export const BUDGET_KEYS = ['minimal', 'low', 'medium', 'high'] as const
export type BudgetKey = (typeof BUDGET_KEYS)[number]

/** JavaScript timer ceiling shared by every delay-shaped field (dsh-timeout). */
export const MAX_TIMER_DELAY_MS = 2_147_483_647

/** Effective defaults the adapter applies where configuration is silent. */
export const EFFECTIVE_DEFAULTS = {
  retryMaxRetries: 5,
  retryInitialDelayMs: 500,
  retryMaxDelayMs: 10_000,
  retryJitterRatio: 0.1,
  streamIdleTimeoutMs: 300_000,
  defaultContextWindow: 262_144,
  defaultMaxTokens: 32_768,
  maxRequestImageBytes: 20 * 1024 * 1024,
  requestImagePixelBudget: 2048 * 2048,
  requestImageMaxBytes: 1024 * 1024,
} as const

/* ------------------------------------------------------------------ */
/* Stored shapes (schema-loose on purpose: the snapshot is the doc).   */
/* ------------------------------------------------------------------ */

export interface PiAiModel {
  id?: string
  name?: string
  reasoningEfforts?: unknown
}

export interface PiAiRetryBackoff {
  initialDelayMs?: unknown
  maxDelayMs?: unknown
  jitterRatio?: unknown
}

export interface PiAiRetryPolicy {
  mode?: unknown
  maxRetries?: unknown
  retryableCodes?: unknown
  backoff?: PiAiRetryBackoff
}

export interface PiAiThinkingBudgets {
  minimal?: unknown
  low?: unknown
  medium?: unknown
  high?: unknown
}

export interface PiAiRoute {
  displayName?: string
  reasoning?: string
  models?: PiAiModel[]
  retryPolicy?: PiAiRetryPolicy
  transport?: string
  cacheRetention?: string
  thinkingBudgets?: PiAiThinkingBudgets
  defaultContextWindow?: unknown
  defaultMaxTokens?: unknown
  defaultInput?: unknown
  timeoutMs?: unknown
  websocketConnectTimeoutMs?: unknown
  streamIdleTimeoutMs?: unknown
  maxRequestImageBytes?: unknown
  requestImagePixelBudget?: unknown
  requestImageMaxBytes?: unknown
}

export interface PiAiSection {
  providers?: Record<string, PiAiRoute>
}

/* ------------------------------------------------------------------ */
/* Draft model — string-backed so free typing survives re-renders.     */
/* ------------------------------------------------------------------ */

/** How one model's reasoning is currently declared. */
export type EffortState =
  | { kind: 'inherit' }
  | { kind: 'off' }
  | { kind: 'on'; levels: ReadonlySet<ReasoningLevel>; wire?: Record<string, string>; offEmpty?: boolean }

export interface RetryDraft {
  mode: 'normal' | 'always'
  /** '' = inherit the default (5). */
  maxRetries: string
  /** Explicit eligible failure codes; [] inherits the five-code default set. */
  codes: string[]
  /** All '' = inherit defaults (500ms / 10000ms / 0.1). */
  initialDelayMs: string
  maxDelayMs: string
  jitterRatio: string
}

/** Every plain-number route field, keyed as the stored document spells it. */
export type NumberKey =
  | 'timeoutMs'
  | 'websocketConnectTimeoutMs'
  | 'streamIdleTimeoutMs'
  | 'defaultContextWindow'
  | 'defaultMaxTokens'
  | 'maxRequestImageBytes'
  | 'requestImagePixelBudget'
  | 'requestImageMaxBytes'

export type BudgetDraft = Record<BudgetKey, string>

export interface ParamsDraft {
  /** Route default thinking level; '' = unset (provider default). */
  reasoningDefault: string
  retry: RetryDraft
  numbers: Record<NumberKey, string>
  /** '' = unset. */
  transport: string
  /** '' = unset. */
  cacheRetention: string
  /** Tri-state modalities: absent key vs an explicit (non-empty) list. */
  inputPresent: boolean
  inputMods: string[]
  budgets: BudgetDraft
}

export interface NumberFieldSpec {
  key: NumberKey
  /** Locale key of the field label. */
  label: string
  kind: 'natural' | 'bounded-delay' | 'positive-int'
}

export const NUMBER_FIELDS: ReadonlyArray<NumberFieldSpec> = [
  { key: 'timeoutMs', label: 'timeoutMs', kind: 'natural' },
  { key: 'websocketConnectTimeoutMs', label: 'websocketConnectTimeoutMs', kind: 'natural' },
  { key: 'streamIdleTimeoutMs', label: 'streamIdleTimeoutMs', kind: 'bounded-delay' },
  { key: 'defaultContextWindow', label: 'defaultContextWindow', kind: 'positive-int' },
  { key: 'defaultMaxTokens', label: 'defaultMaxTokens', kind: 'positive-int' },
  { key: 'maxRequestImageBytes', label: 'maxRequestImageBytes', kind: 'positive-int' },
  { key: 'requestImagePixelBudget', label: 'requestImagePixelBudget', kind: 'positive-int' },
  { key: 'requestImageMaxBytes', label: 'requestImageMaxBytes', kind: 'positive-int' },
]

/** A fresh draft holding nothing (every field inherits). */
export function emptyParamsDraft(): ParamsDraft {
  return {
    reasoningDefault: '',
    retry: { mode: 'normal', maxRetries: '', codes: [], initialDelayMs: '', maxDelayMs: '', jitterRatio: '' },
    numbers: {
      timeoutMs: '',
      websocketConnectTimeoutMs: '',
      streamIdleTimeoutMs: '',
      defaultContextWindow: '',
      defaultMaxTokens: '',
      maxRequestImageBytes: '',
      requestImagePixelBudget: '',
      requestImageMaxBytes: '',
    },
    transport: '',
    cacheRetention: '',
    inputPresent: false,
    inputMods: [],
    budgets: { minimal: '', low: '', medium: '', high: '' },
  }
}

/** Seed a draft from the stored route (absent fields stay ''). */
export function paramsDraftOf(route: PiAiRoute | undefined): ParamsDraft {
  const draft = emptyParamsDraft()
  if (route === undefined) return draft
  draft.reasoningDefault = typeof route.reasoning === 'string' ? route.reasoning : ''
  const r = route.retryPolicy
  if (typeof r === 'object' && r !== null) {
    draft.retry.mode = r.mode === 'always' ? 'always' : 'normal'
    draft.retry.maxRetries = numberText(r.maxRetries)
    const codes = r.retryableCodes
    if (Array.isArray(codes)) draft.retry.codes = codes.filter((c): c is string => typeof c === 'string')
    if (typeof r.backoff === 'object' && r.backoff !== null) {
      draft.retry.initialDelayMs = numberText(r.backoff.initialDelayMs)
      draft.retry.maxDelayMs = numberText(r.backoff.maxDelayMs)
      draft.retry.jitterRatio = numberText(r.backoff.jitterRatio)
    }
  }
  for (const field of NUMBER_FIELDS) {
    draft.numbers[field.key] = numberText((route as Record<string, unknown>)[field.key])
  }
  draft.transport = typeof route.transport === 'string' ? route.transport : ''
  draft.cacheRetention = typeof route.cacheRetention === 'string' ? route.cacheRetention : ''
  const input = route.defaultInput
  if (Array.isArray(input)) {
    draft.inputPresent = true
    draft.inputMods = input.filter((m): m is string => typeof m === 'string')
  }
  const budgets = route.thinkingBudgets
  if (typeof budgets === 'object' && budgets !== null) {
    for (const key of BUDGET_KEYS) draft.budgets[key] = numberText((budgets as Record<string, unknown>)[key])
  }
  return draft
}

function numberText(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : ''
}

/* ------------------------------------------------------------------ */
/* Parsing + validation (mirrors host resolution rules).               */
/* ------------------------------------------------------------------ */

/** Parse a draft string into a finite number; '' (or garbage) yields undefined. */
export function parseNumber(text: string): number | undefined {
  const trimmed = text.trim()
  if (trimmed.length === 0) return undefined
  const value = Number(trimmed)
  return Number.isFinite(value) ? value : undefined
}

/** Machine-readable validation failure kinds (locale keys under `err*`). */
export type ValidationError =
  | 'errNumber'
  | 'errNatural'
  | 'errDelayBound'
  | 'errPositiveInt'
  | 'errRatio'
  | 'errInitialAboveMax'
  | 'errInputEmpty'

export interface FieldIssue {
  /** Locale key naming the offending field. */
  field: string
  kind: ValidationError
}

function issue(field: string, kind: ValidationError): FieldIssue {
  return { field, kind }
}

/** Validate one plain-number field against its host-side bounds. */
export function validateNumberField(key: NumberKey, text: string): FieldIssue | undefined {
  const kind = NUMBER_FIELDS.find(f => f.key === key)?.kind
  const field = NUMBER_FIELDS.find(f => f.key === key)?.label ?? key
  const value = parseNumber(text)
  if (text.trim() === '') return undefined
  if (value === undefined) return issue(field, 'errNumber')
  switch (kind) {
    case 'natural':
      if (!Number.isInteger(value) || value < 0) return issue(field, 'errNatural')
      return undefined
    case 'bounded-delay':
      if (!(value > 0) || value > MAX_TIMER_DELAY_MS) return issue(field, 'errDelayBound')
      return undefined
    case 'positive-int':
      if (!Number.isSafeInteger(value) || value < 1) return issue(field, 'errPositiveInt')
      return undefined
    default:
      return undefined
  }
}

/** Validate the retry draft exactly where the host's `resolveRetryPolicy` would throw. */
export function validateRetryDraft(draft: RetryDraft): FieldIssue[] {
  const issues: FieldIssue[] = []
  if (draft.mode === 'normal') {
    if (draft.maxRetries.trim() !== '') {
      const retries = parseNumber(draft.maxRetries)
      if (retries === undefined || !Number.isSafeInteger(retries) || retries < 0) {
        issues.push(issue('maxRetries', 'errNatural'))
      }
    }
  }
  const initial = draft.initialDelayMs.trim() === '' ? undefined : parseNumber(draft.initialDelayMs)
  const max = draft.maxDelayMs.trim() === '' ? undefined : parseNumber(draft.maxDelayMs)
  if (draft.initialDelayMs.trim() !== '' && (initial === undefined || !(initial > 0) || initial > MAX_TIMER_DELAY_MS)) {
    issues.push(issue('initialDelayMs', 'errDelayBound'))
  }
  if (draft.maxDelayMs.trim() !== '' && (max === undefined || !(max > 0) || max > MAX_TIMER_DELAY_MS)) {
    issues.push(issue('maxDelayMs', 'errDelayBound'))
  }
  if (initial !== undefined && max !== undefined && initial > max) {
    issues.push(issue('initialDelayMs', 'errInitialAboveMax'))
  }
  if (draft.jitterRatio.trim() !== '') {
    const ratio = parseNumber(draft.jitterRatio)
    if (ratio === undefined || ratio < 0 || ratio > 1) issues.push(issue('jitterRatio', 'errRatio'))
  }
  return issues
}

/** Validate every managed field of the draft; [] means locally serviceable. */
export function validateParamsDraft(draft: ParamsDraft): FieldIssue[] {
  const issues: FieldIssue[] = []
  for (const field of NUMBER_FIELDS) {
    const found = validateNumberField(field.key, draft.numbers[field.key])
    if (found !== undefined) issues.push(found)
  }
  issues.push(...validateRetryDraft(draft.retry))
  if (draft.inputPresent && draft.inputMods.length === 0) {
    issues.push(issue('defaultInput', 'errInputEmpty'))
  }
  for (const key of BUDGET_KEYS) {
    if (draft.budgets[key].trim() !== '' && parseNumber(draft.budgets[key]) === undefined) {
      issues.push(issue(`budget_${key}`, 'errNumber'))
    }
  }
  return issues
}

/* ------------------------------------------------------------------ */
/* Wire building + op diffing.                                         */
/* ------------------------------------------------------------------ */

/** A settings path operation (structural twin of the RPC's `SettingsPathOpView`). */
export type ParamOp =
  | { op: 'set'; path: string[]; value: unknown }
  | { op: 'unset'; path: string[] }

/** Canonical JSON: object keys sorted, so stored-vs-built comparisons are key-order independent. */
export function stable(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined'
  if (Array.isArray(value)) return `[${value.map(item => stable(item)).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined)
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(',')}}`
}

/**
 * The `retryPolicy` dict a draft produces, or `undefined` when it collapses to
 * the adapter's implicit defaults (normal mode with nothing explicit — writing
 * that object would be noise, and unsetting restores the same behavior).
 * Normal-only fields are dropped in `always` mode, mirroring how the host
 * ignores them there.
 */
export function retryWireOf(draft: RetryDraft): PiAiRetryPolicy | undefined {
  const backoff: PiAiRetryBackoff = {}
  const initial = parseNumber(draft.initialDelayMs)
  const max = parseNumber(draft.maxDelayMs)
  const ratio = parseNumber(draft.jitterRatio)
  if (draft.initialDelayMs.trim() !== '' && initial !== undefined) backoff.initialDelayMs = initial
  if (draft.maxDelayMs.trim() !== '' && max !== undefined) backoff.maxDelayMs = max
  if (draft.jitterRatio.trim() !== '' && ratio !== undefined) backoff.jitterRatio = ratio
  const hasBackoff = Object.keys(backoff).length > 0
  if (draft.mode === 'always') {
    return hasBackoff ? { mode: 'always', backoff } : { mode: 'always' }
  }
  const maxRetries = parseNumber(draft.maxRetries)
  const hasRetries = draft.maxRetries.trim() !== '' && maxRetries !== undefined
  const hasCodes = draft.codes.length > 0
  if (!hasRetries && !hasCodes && !hasBackoff) return undefined
  const wire: PiAiRetryPolicy = { mode: 'normal' }
  if (hasRetries) wire.maxRetries = maxRetries
  if (hasCodes) wire.retryableCodes = [...draft.codes]
  if (hasBackoff) wire.backoff = backoff
  return wire
}

function budgetsWireOf(draft: BudgetDraft): PiAiThinkingBudgets | undefined {
  const wire: PiAiThinkingBudgets = {}
  for (const key of BUDGET_KEYS) {
    const value = parseNumber(draft[key])
    if (draft[key].trim() !== '' && value !== undefined) wire[key] = value
  }
  return Object.keys(wire).length > 0 ? wire : undefined
}

/**
 * Diff the draft against the stored route into a minimal op set covering EVERY
 * managed route-level parameter. Unset wins over set when the draft clears a
 * present key; identical composites produce no op (key-order independent).
 */
export function buildRouteOps(current: PiAiRoute | undefined, draft: ParamsDraft): ParamOp[] {
  const ops: ParamOp[] = []
  const cur = current ?? {}
  const pushScalar = (key: string, wire: unknown, stored: unknown): void => {
    if (wire === undefined) {
      if (stored !== undefined) ops.push({ op: 'unset', path: [key] })
      return
    }
    if (stable(stored) !== stable(wire)) ops.push({ op: 'set', path: [key], value: wire })
  }

  pushScalar('reasoning', draft.reasoningDefault === '' ? undefined : draft.reasoningDefault, cur.reasoning)
  for (const field of NUMBER_FIELDS) {
    const text = draft.numbers[field.key]
    pushScalar(field.key, text.trim() === '' ? undefined : parseNumber(text), (cur as Record<string, unknown>)[field.key])
  }
  pushScalar('transport', draft.transport === '' ? undefined : draft.transport, cur.transport)
  pushScalar('cacheRetention', draft.cacheRetention === '' ? undefined : draft.cacheRetention, cur.cacheRetention)
  pushScalar(
    'defaultInput',
    draft.inputPresent && draft.inputMods.length > 0 ? [...draft.inputMods] : undefined,
    cur.defaultInput,
  )
  pushScalar('thinkingBudgets', budgetsWireOf(draft.budgets), cur.thinkingBudgets)
  pushScalar('retryPolicy', retryWireOf(draft.retry), cur.retryPolicy)
  return ops
}

/* ------------------------------------------------------------------ */
/* Per-model reasoning helpers (moved verbatim from the old section).  */
/* ------------------------------------------------------------------ */

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
export function wireOf(
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
