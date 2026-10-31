/**
 * Provider parameters settings plugin (Smoothly Model Reasoning / Smoothly MR,
 * 思磨力提供方参数),
 * browser half (external, not part of the DSH repository). Registers the
 * bundle's own configuration on the **Plugins page** (`plugins.bundle.config`,
 * keyed by this package's name): the page renders it between the bundle's
 * description and its rows. It manages per-provider route parameters (retry &
 * backoff policy, timeouts, transport, caching, thinking budgets, capacities,
 * request image budgets) plus the per-model reasoning declaration for
 * third-party pi-ai providers — writing the same
 * `llm-pi-ai.providers.<route>.*` fields the adapter reads. It rides the same
 * slot + settings-forms (`configForms`) seams the built-in Models page uses,
 * so official updates to the repository never touch it.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the settings-forms contract (ConfigForm).
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the Plugins page's SlotMap merge (the 'plugins.bundle.config'
// entry) into this program.
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
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
 * ui-settings; registration depends on it through `slots.inject()`. Reads ride
 * the settings-forms service (`configForms`, the dsh 0.1.7 successor of the
 * removed `settingsScope` seam); the `remote.settings` namespace carries this
 * page's writes (dsh 0.1.2+ replaced the `connection.api` RPC face with the
 * generated Remote namespaces — writes stay on the raw Remote call so
 * conflict/refusal details survive; see the 2026-08-30 agent note). */
export const inject = ['slots', 'locale', 'remote', 'remote.settings', 'configForms']

/**
 * Register the bundle's configuration once the Plugins page's
 * `plugins.bundle.config` declaration is on the ledger, binding the
 * `llm-pi-ai` namespace scope on this plugin's lifecycle.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-model-reasoning: copy dictionaries')

  const form: ConfigForm<PiAiSection> = ctx.configForms.get<PiAiSection>(PI_AI_NS)
  const t = ctx.locale.bind(NS) as ProviderParamsInjected['t']
  const injected = (): ProviderParamsInjected => ({
    api: ctx.remote.settings,
    t,
    hooks: { modelReasoning: form },
  })

  ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
    name: 'plugins.bundle.config',
    key: 'dsh-model-reasoning',
    locale: NS,
    inject: injected,
  }, ProviderParamsSection))
}
