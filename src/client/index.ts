/**
 * Provider parameters settings plugin, browser half (external, not part of the
 * DSH repository). Registers a Settings page that manages per-provider route
 * parameters (retry & backoff policy, timeouts, transport, caching, thinking
 * budgets, capacities, request image budgets) plus the per-model reasoning
 * declaration for third-party pi-ai providers — writing the same
 * `llm-pi-ai.providers.<route>.*` fields the adapter reads. It rides the same
 * slot + settingsScope seams the built-in Models page uses, so official
 * updates to the repository never touch it.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the shell's SlotMap merge (the 'settings.section' entry)
// and the settings-namespace scope contract (SettingsScope).
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the renderer's Context merge (ctx.slots) into this program.
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the ctx.remote merge into this program.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import { ProviderParamsSection, type ProviderParamsInjected } from './ProviderParamsSection.tsx'
import type { PiAiSection } from './params.ts'
// Side-effect import: injects the design-token styles at module evaluation
// (module-top-level side effects survive tree-shaking, unlike a closure-only
// call, which rolldown dropped and crashed the whole web client).
import './styles.ts'
import { en, zh, type ParamKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The Provider parameters page copy. */
    'provider-params': ParamKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'provider-params'

/** The pi-ai settings namespace whose provider profiles this page edits. */
const PI_AI_NS = 'llm-pi-ai'

/** Required services (cordis fiber inject). The target slot is declared by
 * ui-settings; registration depends on it through `slots.inject()`. The
 * `remote.settings` namespace carries this page's writes (dsh 0.1.2+ replaced
 * the `connection.api` RPC face with the generated Remote namespaces). */
export const inject = ['slots', 'locale', 'remote', 'remote.settings', 'settingsScope']

/**
 * Register the Provider parameters section once the `settings.section`
 * declaration is on the ledger, binding the `llm-pi-ai` namespace scope on this
 * plugin's lifecycle.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-model-reasoning: copy dictionaries')

  const scope: SettingsScope<PiAiSection> = ctx.settingsScope.bind({ namespace: PI_AI_NS })
  const t = ctx.locale.bind(NS) as ProviderParamsInjected['t']
  const injected = (): ProviderParamsInjected => ({
    api: ctx.remote.settings,
    t,
    hooks: { modelReasoning: scope },
  })

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'provider-params',
    order: 20,
    label: () => t('nav'),
    inject: injected,
  }, ProviderParamsSection))
}
