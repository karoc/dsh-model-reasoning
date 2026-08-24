/**
 * Unit tests for the pure parameter registry (params.ts).
 *
 * The validators here mirror the host's own resolution rules
 * (llm-pi-ai/src/config.ts + dsh-llm/src/retry-policy.ts); these tests pin the
 * mirror so a host rule change that lands in a descriptor update cannot drift
 * silently. Run with `npm test` (node --test executes TypeScript directly).
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  EFFECTIVE_DEFAULTS,
  buildRouteOps,
  effortStateOf,
  emptyParamsDraft,
  paramsDraftOf,
  retryWireOf,
  stable,
  validateParamsDraft,
  wireOf,
} from '../src/client/params.ts'
import type { PiAiRoute } from '../src/client/params.ts'

describe('effortStateOf / wireOf round trip', () => {
  it('reads false as off and absent as inherit', () => {
    assert.deepEqual(effortStateOf(false), { kind: 'off' })
    assert.deepEqual(effortStateOf(undefined), { kind: 'inherit' })
    assert.deepEqual(effortStateOf('junk'), { kind: 'inherit' })
  })

  it('captures levels, wire spellings, and off-empty semantics', () => {
    const state = effortStateOf({ low: 'low', max: 'ultra', high: null })
    assert.equal(state.kind, 'on')
    assert.ok(state.kind === 'on')
    assert.deepEqual([...state.levels].sort(), ['high', 'low', 'max'])
    assert.equal(state.wire?.max, 'ultra')
    assert.equal(state.offEmpty, true)
  })

  it('reproduces the stored dict through wireOf', () => {
    const dict = { minimal: 'tiny', off: null, high: 'high' }
    const state = effortStateOf(dict)
    assert.ok(state.kind === 'on')
    assert.deepEqual(wireOf(state.levels, state.wire ?? {}, state.offEmpty), dict)
  })

  it('off with a custom spelling round trips as a value', () => {
    const state = effortStateOf({ off: 'nope', low: 'low' })
    assert.ok(state.kind === 'on' && state.offEmpty === false)
    assert.deepEqual(wireOf(state.levels, state.wire ?? {}, state.offEmpty), { off: 'nope', low: 'low' })
  })
})

describe('retryWireOf', () => {
  it('collapses an all-default normal draft to unset', () => {
    const draft = emptyParamsDraft()
    assert.equal(retryWireOf(draft.retry), undefined)
  })

  it('keeps explicit partials sparse', () => {
    const wire = retryWireOf({ mode: 'normal', maxRetries: '', codes: [], initialDelayMs: '250', maxDelayMs: '', jitterRatio: '' })
    assert.deepEqual(wire, { mode: 'normal', backoff: { initialDelayMs: 250 } })
  })

  it('always mode drops normal-only fields', () => {
    const wire = retryWireOf({ mode: 'always', maxRetries: '3', codes: ['RATE_LIMIT'], initialDelayMs: '', maxDelayMs: '9000', jitterRatio: '' })
    assert.deepEqual(wire, { mode: 'always', backoff: { maxDelayMs: 9000 } })
  })
})

describe('buildRouteOps', () => {
  it('emits nothing for a fresh route against an inherit-everything draft', () => {
    assert.deepEqual(buildRouteOps(undefined, emptyParamsDraft()), [])
  })

  it('sets one scalar override precisely', () => {
    const draft = emptyParamsDraft()
    draft.numbers.timeoutMs = '45000'
    const ops = buildRouteOps(undefined, draft)
    assert.deepEqual(ops, [{ op: 'set', path: ['timeoutMs'], value: 45000 }])
  })

  it('unsets a removed override instead of writing a default echo', () => {
    const route: PiAiRoute = { timeoutMs: 123 }
    const ops = buildRouteOps(route, emptyParamsDraft())
    assert.deepEqual(ops, [{ op: 'unset', path: ['timeoutMs'] }])
  })

  it('is key-order independent for composite values', () => {
    const route: PiAiRoute = {
      retryPolicy: { mode: 'normal', backoff: { jitterRatio: 0.2, maxDelayMs: 9000, initialDelayMs: 250 } },
    }
    const draft = paramsDraftOf(route)
    assert.deepEqual(buildRouteOps(route, draft), [])
  })

  it('rewrites the whole retryPolicy subtree on a mode flip', () => {
    const route: PiAiRoute = { retryPolicy: { mode: 'always', backoff: { initialDelayMs: 100 } } }
    const draft = paramsDraftOf(route)
    draft.retry.mode = 'normal'
    const ops = buildRouteOps(route, draft)
    assert.equal(ops.length, 1)
    assert.equal(ops[0]?.op, 'set')
    // Backoff is shared by both modes, so it survives the flip; normal-only
    // fields stay absent until set.
    assert.deepEqual(ops[0], {
      op: 'set',
      path: ['retryPolicy'],
      value: { mode: 'normal', backoff: { initialDelayMs: 100 } },
    })
  })

  it('writes thinkingBudgets sparsely and unsets when emptied', () => {
    const draft = emptyParamsDraft()
    draft.budgets.high = '8192'
    assert.deepEqual(
      buildRouteOps(undefined, draft),
      [{ op: 'set', path: ['thinkingBudgets'], value: { high: 8192 } }],
    )
    const route: PiAiRoute = { thinkingBudgets: { high: 8192 } }
    assert.deepEqual(
      buildRouteOps(route, paramsDraftOf(route)),
      [],
    )
  })

  it('maps defaultInput checkboxes to a list op and clearing to unset', () => {
    const draft = emptyParamsDraft()
    draft.inputPresent = true
    draft.inputMods = ['image']
    assert.deepEqual(
      buildRouteOps(undefined, draft),
      [{ op: 'set', path: ['defaultInput'], value: ['image'] }],
    )
    draft.inputPresent = false
    draft.inputMods = []
    const route: PiAiRoute = { defaultInput: ['text'] }
    assert.deepEqual(
      buildRouteOps(route, draft),
      [{ op: 'unset', path: ['defaultInput'] }],
    )
  })

  it('collapses an exact-full-default retry policy to no op', () => {
    const route: PiAiRoute = {
      retryPolicy: {
        mode: 'normal',
        maxRetries: EFFECTIVE_DEFAULTS.retryMaxRetries,
        retryableCodes: ['EMPTY_RESPONSE', 'RATE_LIMIT', 'SERVER', 'TIMEOUT', 'TRANSPORT'],
        backoff: { initialDelayMs: 500, maxDelayMs: 10000, jitterRatio: 0.1 },
      },
    }
    assert.deepEqual(buildRouteOps(route, paramsDraftOf(route)), [])
  })
})

describe('validateParamsDraft mirrors host rules', () => {
  it('accepts an inherit-everything draft', () => {
    assert.deepEqual(validateParamsDraft(emptyParamsDraft()), [])
  })

  it('bounds jitterRatio to [0, 1]', () => {
    const draft = emptyParamsDraft()
    draft.retry.jitterRatio = '1.5'
    assert.deepEqual(validateParamsDraft(draft).map(i => i.field), ['jitterRatio'])
  })

  it('enforces initialDelayMs <= maxDelayMs only when both are given', () => {
    const draft = emptyParamsDraft()
    draft.retry.initialDelayMs = '20'
    draft.retry.maxDelayMs = '10'
    assert.ok(validateParamsDraft(draft).some(i => i.kind === 'errInitialAboveMax'))
    draft.retry.maxDelayMs = ''
    assert.ok(!validateParamsDraft(draft).some(i => i.kind === 'errInitialAboveMax'))
  })

  it('rejects negative retries, zero idle timeout, and fractional capacities', () => {
    const draft = emptyParamsDraft()
    draft.retry.maxRetries = '-1'
    draft.numbers.streamIdleTimeoutMs = '0'
    draft.numbers.defaultContextWindow = '0.5'
    const kinds = validateParamsDraft(draft)
    assert.deepEqual(kinds.map(i => `${i.field}:${i.kind}`).sort(), [
      'defaultContextWindow:errPositiveInt',
      'maxRetries:errNatural',
      'streamIdleTimeoutMs:errDelayBound',
    ])
  })

  it('rejects non-numeric text in numeric fields', () => {
    const draft = emptyParamsDraft()
    draft.numbers.timeoutMs = 'abc'
    assert.deepEqual(validateParamsDraft(draft), [{ field: 'timeoutMs', kind: 'errNumber' }])
  })
})

describe('stable', () => {
  it('is key-order independent and array-order sensitive', () => {
    assert.equal(stable({ a: 1, b: { c: 2, d: 3 } }), stable({ b: { d: 3, c: 2 }, a: 1 }))
    assert.notEqual(stable(['a', 'b']), stable(['b', 'a']))
  })
})
