/**
 * Model reasoning settings plugin, browser half (external, not part of the DSH
 * repository). Registers a Settings page that configures per-model thinking
 * levels (reasoning efforts) for third-party pi-ai providers, writing the
 * `llm-pi-ai.providers.<route>.models[].reasoningEfforts` and route-level
 * `reasoning` fields. It rides the same slot + settingsScope seams the built-in
 * Models page uses, so official updates to the repository never touch it.
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle, IApiClient } from '@deepseek-ai/dsh-api-remotes/client'
import type { SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the shell's SlotMap merge (the 'settings.section' entry).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the ctx.remote merge into this program.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import { ReasoningSection, type ReasoningSectionInjected, type PiAiSection } from './ReasoningSection.tsx'
// Side-effect import: injects the design-token styles at module evaluation
// (module-top-level side effects survive tree-shaking, unlike a closure-only
// call, which rolldown dropped and crashed the whole web client).
import './styles.ts'
import { en, zh, type ReasoningKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The Model reasoning page copy. */
    'model-reasoning': ReasoningKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'model-reasoning'

/** The pi-ai settings namespace whose provider profiles this page edits. */
const PI_AI_NS = 'llm-pi-ai'

/** Required services (cordis fiber inject). The target slot is declared by
 * ui-settings; registration depends on it through `slots.inject()`. */
export const inject = ['slots', 'locale', 'connection', 'remote', 'settingsScope']

/**
 * Register the Model reasoning section once the `settings.section` declaration
 * is on the ledger, binding the `llm-pi-ai` namespace scope on this plugin's
 * lifecycle.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-model-reasoning: copy dictionaries')

  const connection = ctx.get('connection') as ConnectionHandle
  const scope: SettingsScope<PiAiSection> = ctx.settingsScope.bind({ namespace: PI_AI_NS })
  const t = ctx.locale.bind(NS) as ReasoningSectionInjected['t']
  const injected = (): ReasoningSectionInjected => ({
    api: connection.api,
    t,
    hooks: { modelReasoning: scope },
  })

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'model-reasoning',
    order: 20,
    label: () => t('nav'),
    inject: injected,
  }, ReasoningSection))
}
