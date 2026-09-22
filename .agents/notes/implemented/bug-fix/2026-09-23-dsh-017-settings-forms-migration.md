# Agent Note: dsh-017-settings-forms-migration

Status: implemented

## Problem

在 dsh 0.1.7-alpha.1（c36a83f）上，dsh-model-reasoning 的客户端插件不再激活：web 启动横幅显示「Failed to load plugins / web boot: 1 entry did not activate / dsh-model-reasoning: pending (waiting for service: settingsScope)」，Settings → 思磨力提供方参数 页面消失。

根因排查：0.1.7 内的 #4587（601d6761e4）删除了 `settingsScope` 客户端服务与 `settings-contract.ts`（旧 `SettingsScope` / `SettingsScopeSnapshot` / `SettingsScopeBinder` 一并移除），设置读取改为设置表单服务 `configForms`（`ConfigForm` / `ConfigFormSnapshot`，见 `packages/client/ui-settings/src/client/config-form.ts`）。新接口与旧 scope 形状完全一致：`getSnapshot` / `subscribe` / `set` / `unset` / `mutate`，快照字段同为 `{status, value, base, user, revision, writable, mode}` —— 即机械替换，无语义漂移。0.1.7 同时统一了客户端视觉语言（4937343a5e）：图标去掉尺寸后缀、笔画权重成为命名变体（`*Regular` = 1px，`*Medium` = 1.3px），旧名 `IconChevronDownOutline14` / `IconThinkOutline16` 直接消失（undefined 组件）。

## Decision

v0.2.5 客户端迁移到设置表单线：

- fiber inject `settingsScope` → `configForms`；`ctx.settingsScope.bind({ namespace })` → `ctx.configForms.get<PiAiSection>('llm-pi-ai')`；
- 类型导入 `SettingsScope*` → `ConfigForm*`（仍自 `@deepseek-ai/dsh-client-ui-settings/client`，0.1.7 起在此导出）；
- 写路径不变：仍走 `ctx.remote.settings.mutate(ns, ops, expectedRevision)`（与 0.1.7 内置 Models 页 `operations.ts` 的调用面一致；不改为 `form.mutate` 的理由同 0.1.2 note——它只回 boolean，冲突/拒绝细节被吞，页面需要展示 host 消息）；
- 图标随视觉语言改名：`IconChevronDownOutline14` → `IconChevronDownOutlineRegular`、`IconThinkOutline16` → `IconThinkOutlineRegular`（尺寸默认不变，Regular 与内置页用法一致）；
- README 兼容性表述更新为「低于 0.1.7 不再支持」（单向上行，与 0.1.2 迁移同一政策）。

验证（全部实测）：`tsc --noEmit`（TS 6.0.3；node_modules/@deepseek-ai 符号链接重指到 /srv/deepseek-harness 源码包与 vendor/cordis）通过；28 条 node 单测通过；隔离 DSH_HOME（副本含导入后的 profile patch）+ 真实 dsh 0.1.7 + Playwright 端到端：启动横幅不再点名该插件、设置导航出现「Smoothly MR」、路由选择器读到 7 条已存路由（火山方舟 Agent Plan K 等）、Timeouts 组写入 `timeoutMs=12345` → Save → 锚定路径 `llm-pi-ai.providers.volcengine-agent-plan-k.timeoutMs` 单行落盘（仅删该行即字节级回到原文件）、读回显示 12345、清空字段再 Save 后文件 sha256 与原始完全一致。顺带确认 0.1.7 的存储迁移（settings.yaml → profile `cordis.patch.yml`）对此插件透明：保存仍只改 profile patch 一个文件。

## Alternatives considered

**兼容 shim（两个服务都注入、运行时谁在就用谁）**：被否决——0.1.7 已无 `settingsScope`，shim 只能保住旧版，掩盖 API 漂移，且与「适配最新 dsh」目标相反。
**`whileServed` 门控注册（namespace 未服务时不显示页面）**：被否决——旧行为是页面常驻并在加载/不可用时给出提示（README 明确承诺）；保持行为不变的最小迁移。
**改用 `form.mutate` 写路径**：被否决，理由同 0.1.2 note——返回 boolean 无失败细节，页面无法区分冲突与一般拒绝。

## Consequences

代价：与 dsh < 0.1.7 不再兼容（单向上行，升级方向单一）。收益：0.1.7 下页面完整可用，读/写/清空往返全部经真实 GUI 验证（含字节级还原）。跟进义务：设置线若再次迁移，重查 `configForms` 形状与快照字段；本机类型检查依赖 node_modules/@deepseek-ai 符号链接（已重指；harness 再升级需重指）。相关 note：2026-08-30-dsh-012-settings-wire-migration-and-route-op-anchoring.md。
