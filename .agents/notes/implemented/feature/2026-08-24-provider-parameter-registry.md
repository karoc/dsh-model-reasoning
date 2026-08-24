# Agent Note: provider-parameter-registry

Status: implemented

## Problem

dsh-model-reasoning 原本只管 reasoningEfforts 一个字段，编辑器硬编码在单个 React 组件里；要扩展成提供方参数管理（重试/退避/超时/传输/缓存/预算/容量共 20+ 字段），若按原样堆砌会产生大量重复的 dirty/save/校验代码，且本地校验无法保证与 host 的 assertServiceable→resolveProfiles 规则一致，用户会先撞上晦涩的 settings-rejected 报错。

## Decision

新增 src/client/params.ts 作为唯一事实源：NUMBER_FIELDS 描述符表、EFFECTIVE_DEFAULTS、字符串背书的 ParamsDraft（保住自由输入）、validateParamsDraft（逐条镜像 resolveRetryPolicy/config.ts 的边界：maxRetries≥0 安全整数、延迟>0 且 ≤2147483647ms、initial≤max、jitterRatio∈[0,1]、容量正整数、defaultInput 非空）、buildRouteOps 用 stable() 键序无关 JSON 比较产出最小 op 集——标量精确 set/unset 单键，retryPolicy/thinkingBudgets/defaultInput/models 整键写（host path-op 不能寻址数组下标）。exact-full-defaults 的 normal retryPolicy 折叠为 unset（等价适配器隐含默认）；退避跨模式共享故 mode 切换时保留。ReasoningSection.tsx 由 ProviderParamsSection.tsx 取代（壳：全部 providers 路由选择器+五分组 Pill 页签+统一保存引擎），section id 与 locale NS 改为 provider-params，npm 包名/bundle id/cordis.patch 行 id 不变（升级兼容）。own-save 成功后草稿恰好回种一次新快照（useRef 标记 revision 变化），外部并发改动不回种、照常走 settings-conflict。单测 tests/params.test.ts 21 用例经 node:test 直接执行 TS（node≥23.6 原生 strip-types）。绝不写上游已移除的路由级 legacy 键（provider/maxRetries/maxRetryDelayMs）。
## Alternatives considered

**每个参数组独立 Section 组件**：设置页会碎成七八项，路由选择、revision、busy 状态无法复用，保存逻辑五处重复——输给单一页面+分组页签。**引入表单库（react-hook-form 等）**：bundle 必须自包含（平台包外全部内联），引依赖违背发布形态，且字段量级不需要——输给手写字符串背书草稿。**逐字段 unset backoff/retryPolicy 子键**：mode 切换时子键组合态多、易留脏数据——输给整键写 + 「exact-full-defaults 折叠为 unset」。**改 npm 包名（如 dsh-provider-params）**：安装身份变化要走新包发布+旧包弃用，用户迁移成本高——输给包名/bundle id 不变、仅 section id 与文案改名。
## Consequences

换来：加新路由级参数=在 params.ts 加一条 NUMBER_FIELDS/枚举域+两条文案，UI 自动获得占位默认、校验、op 写入。代价：无运行时验证快照稀疏性（own-save 回种机制对稀疏/物化两种行为均安全，但建议 GUI 实测确认）；模型级编辑仍限显式 models 列表路由（modelOverrides 是二期）；compat/headers 未覆盖；npm publish 及线上 GUI 验证待用户执行。测试为纯函数层，React 组件无自动化测试。

