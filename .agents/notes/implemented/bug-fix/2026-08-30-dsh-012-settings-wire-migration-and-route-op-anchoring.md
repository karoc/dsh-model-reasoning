# Agent Note: dsh-012-settings-wire-migration-and-route-op-anchoring

Status: implemented

## Problem

在 dsh 0.1.2-alpha.2 上，dsh-model-reasoning 的 Settings → Provider parameters 页面导航入口存在但内容为空，插件"没有生效"。根因排查显示 dsh 0.1.2 移除了 `@deepseek-ai/dsh-client-runtime` 包和 `ConnectionHandle.api`（IApiClient）RPC 面，settings 读写改为生成的 `ctx.remote.settings` Remote 命名空间；插件注入的 `connection.api` 变成 undefined，组件守卫渲染 null。

## Decision

dsh-model-reasoning v0.2.2 的客户端迁移到新设置线：`ClientContext` 改从 `@deepseek-ai/cordis` 导入（类型别名）；`SettingsScope`/`SettingsScopeSnapshot` 改从 `@deepseek-ai/dsh-client-ui-settings/client` 导入；fiber inject 改为 `['slots','locale','remote','remote.settings','settingsScope']`（'remote.settings' 跟随内置 Models 页模式）；写路径从 `api.settings.mutate({ns,ops,expectedRevision})` + `response.result.ok`（冲突码 `settings-conflict`）改为 `ctx.remote.settings.mutate(ns, ops, expectedRevision)` 位置参数 + `response.ok` / `response.error.code`（冲突码 `settings/conflict`）。`dsh.client.inject`（package.json）与 tsdown externals 移除已删除的 `dsh-client-runtime` 与不再使用的 `dsh-client-connection`。组件内 `api` 注入面定义为结构化 `SettingsWire` 接口（仅 mutate，类型只读自 api-remotes/client 与 dsh-util-values）。tsconfig 增加 `allowImportingTsExtensions`（源码用显式 .ts/.tsx 扩展名）；node_modules/@deepseek-ai 建立指向当前 harness 包的 symlink（本地类型检查用，不提交）。

顺带修复 0.2.0 起的潜伏回归：`buildRouteOps` 产出路由相对路径（`['timeoutMs']` 等，单测钉死此契约），但组件直接把它们传给命名空间根级 mutate，导致路由级保存落在 `llm-pi-ai.<field>`（schema 未定义、适配器忽略）；新增纯函数 `anchoredRouteOps(routeKey, current, draft)`（params.ts）把每条 op 前缀 `['providers', routeKey]`，组件 routeOps 走它，3 条新单测覆盖。NOT：`applyToAll` 与 modelOps 本就锚定 `providers.<route>`，未动。验证：真实 GUI（0.1.2-alpha.2 + Playwright）下页面渲染存储值、保存往返真实改写 ~/.dsh/settings.yaml 于锚定路径并可字节级还原；tsc --noEmit 与 28 条 node 测试通过。
## Alternatives considered

**API 适配 shim**：在插件内把旧对象参数包装成新 Remote 调用（`{ns,ops,expectedRevision}` → 位置参数 + result 形状翻译）——被否决：掩盖 API 漂移、新旧错误码翻译脆弱，且类型层面 IApiClient 已不存在，无法干净表达。
**改用 `scope.mutate(ops, expectedRevision)`**（新 SettingsScope 自带写路径，内部走同一条 Remote 线）：被否决——它只返回 `Promise<void>`，冲突/拒绝详情被吞掉（失败时内部 reload 恢复），插件需要区分 `settings/conflict`（显示"冲突"文案）与一般拒绝（显示 host 消息），直接调 Remote 保留失败细节。
**不动 dsh.client.inject 列表**（缺失包在 loader 里被静默跳过）：被否决——保留指向已删除包的注入项误导后续维护者，且新版本 graph 组合依赖 accurate inject。
## Consequences

代价：写路径代码与 0.1.2 之前的 dsh 不再兼容（升级方向单一，符合"适配最新 dsh"目标）；类型导入分散到四个包（cordis / ui-settings / api-remotes / dsh-util-values），比旧的单一 runtime 包繁琐。收益：Settings 页在 0.1.2-alpha.2 恢复可用；顺带修复了路由级保存从未生效的 0.2.0 回归（该回归意味着 0.2.0 的 retry/backoff/timeouts/cache/budgets 编辑只是"看起来保存成功"）。跟进义务：dsh 后续大版本若再次迁移设置线，需重查 `ctx.remote.settings` 形状与 `SettingsWire` 接口；本地类型检查依赖 node_modules/@deepseek-ai symlink（harness 升级后需重指，dsh-client-ui-slots 等已直接指向 /srv/deepseek-harness/packages 源目录）。相关 note：2026-08-24-provider-parameter-registry.md（descriptor 框架与字段注册）。

