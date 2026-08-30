# dsh-model-reasoning

[English](README.md) | 简体中文

[![npm version](https://img.shields.io/npm/v/dsh-model-reasoning.svg)](https://www.npmjs.com/package/dsh-model-reasoning)
[![npm downloads](https://img.shields.io/npm/dm/dsh-model-reasoning.svg)](https://www.npmjs.com/package/dsh-model-reasoning)
[![license MIT](https://img.shields.io/npm/l/dsh-model-reasoning.svg)](LICENSE)

一个**外部** DeepSeek Harness Web 客户端插件：新增一个设置页，管理内置 **Models**
页刻意不暴露的提供方路由参数——重试与退避策略、超时、传输方式、缓存、思考预算、
容量、请求图片预算——以及第三方（pi-ai）提供方的**按模型思考等级（推理强度）**。
它写入与适配器读取完全一致的 `llm-pi-ai.providers.<route>.*` 字段，无需任何其他
配置即可生效。

为什么要做成外部插件：给内置 `ui-settings-models` 包加字段会在官方下次发布时被
覆盖。本包作为可安装的 **bundle** 交付，从不触碰仓库源码，官方更新无法覆盖它。

## 它管理什么

设置里新增一项 **「提供方参数 / Provider parameters」**，排在内置 Models 页之后。
选择任意提供方路由——`llm-pi-ai` 的 `providers` 字典里的每个条目都可以在这里编辑，
包括目录路由——在五个参数组里进行管理：

- **按模型**——对带显式 `models` 列表的路由，直接编辑所选模型自己的声明：输入模态
  （`text`/`image`，让纯文本模型与视觉模型在同一提供方下各自声明真实能力）、上下文
  与输出上限（`contextWindow`、`maxTokens`）、思考等级（`reasoningEfforts`：
  继承 / 不思考 / 在 `off minimal low medium high xhigh max` 中勾选集合）及每等级
  自定义线上拼写。模型选择器把**搜索融合进下拉面板**——点开即输入，按名称 / id
  筛选长列表（仅影响展示，不改变存储顺序，也不触碰写入路径）。**应用到所有模型**只把勾选的维度
  （模态 / 上限 / 推理）从编辑器复制到该路由的所有模型；本组还含未设置模型继承的
  路由默认思考等级（`providers.<route>.reasoning`）。
- **重试与退避**：`retryPolicy.mode`（`normal` 有界瞬时重试 vs `always` 无限重试）、
  `maxRetries`、`retryableCodes`（五个稳定预设码 + 自定义码）、以及两种模式共享的
  指数退避（`initialDelayMs`、`maxDelayMs`、`jitterRatio`）。未设置的值回退到适配器
  默认（重试 5 次、首延 500ms、上限 10s、抖动 0.1）。
- **超时与传输**：`timeoutMs`、`websocketConnectTimeoutMs`、
  `streamIdleTimeoutMs`（默认 300000 毫秒），以及 `transport`
  （`auto/sse/websocket/websocket-cached`）。
- **缓存与思考预算**：`cacheRetention`（`none/short/long`）和各等级的
  `thinkingBudgets` token 预算（`minimal/low/medium/high`）。
- **容量与请求预算**：`defaultContextWindow`、`defaultMaxTokens`、`defaultInput`
  模态（`text/image`）——这三项是**回退值**，只被自身未声明的模型读取（真实值请在
  「按模型」页签里逐模型设置）——以及单请求图片负载上限（`maxRequestImageBytes`、
  `requestImagePixelBudget`、`requestImageMaxBytes`）。

每个参数组面板顶部都有**作用范围徽标**：「按模型」写入所选模型自己的声明，留空的
维度继承路由回退值或目录声明；其余四组是「整条路由」——这些字段在 llm-pi-ai 的
schema 里只存在于路由级，一份共享值就是全部事实（悬停徽标的 tooltip 会说明，
旁边不重复展示文字）。

每个字段未设置时以占位符显示生效的适配器默认值；清空字段即移除该覆盖项，而不会把
默认值回写一遍。本地校验镜像 host 自身的解析规则，大多数错误在写入前就会被拦下；
host 仍拒绝的值会把 `settings.mutate` 的报错原样展示。写入路径带 revision 冲突
保护，并发修改会被拒绝而不是被静默覆盖。**应用到所有模型**按钮可把当前模型的思考
声明一键复制到该路由的全部模型。

### 自定义线上拼写（适配任意上游词汇）

每个被选中的思考等级都有一个**线上拼写（wire spelling）**字段（默认等于等级名）。
修改它即可重映射该等级发到上游的值——例如把模型最高档叫 Ultra 时配 `max → ultra`，
或 `high → turbo`。`off` 可以发送空值（默认）或自定义值。

> ⚠️ DSH **不支持**发明新的等级名。pi-ai 的 schema 把 `reasoningEfforts` 的键固定为
> 七个标准等级，解析时也只读取这些键，所以裸写 `ultra:` 键会在写入时被拒绝。「Ultra」
> 应通过重映射已有等级的线上拼写（`max: ultra`）来表达。

### 空状态

尚未配置第三方提供方时，页面显示友好的占位卡片，指向 **设置 → 模型 → 添加自定义
提供方**。选中目录路由（无显式 `models` 列表）时会说明它的**模型**在此只读——目录
模型的推理等级仍在 composer 中选择——而上方的路由级参数组始终可以编辑。设置文档
加载时显示加载中 / 不可用提示。

## 安装

**前置要求：** 已安装带 `dsh` CLI 的 DeepSeek Harness，以及 [pnpm](https://pnpm.io)（`dsh plugin` 命令底层调用 pnpm）。这是一个可安装的 **bundle**——由 `dsh` 加载，不是当作库 import。

**兼容性：** 自 v0.2.2 起，本页面通过 dsh 0.1.2 引入的 settings **Remote** 命名空间（`ctx.remote.settings`）写入；早于 0.1.2 的 dsh 构建（`connection.api` RPC 面）不受支持。

### 从 npm 安装（推荐）

包已发布到 npm，名为 `dsh-model-reasoning`：

```sh
dsh plugin --profile web add dsh-model-reasoning
```

这会安装预构建的 bundle 并把它追加到 `web` profile。然后**重启 `dsh web`**，打开 **设置 → 提供方参数 / Provider parameters**。

### 从 git 安装

```sh
dsh plugin --profile web add github:karoc/dsh-model-reasoning#<sha>
```

git 安装会运行包的 `prepare` 脚本构建 bundle。pnpm ≥ 10 需要把这次构建加入白名单一次——把 pnpm 打印的包 key 复制进 profile 的 `pnpm-workspace.yaml` 的 `allowBuilds`，然后重新执行 `add`（参见 DSH 仓库 `docs/user/develop/basic/publish.md`）。

### 更新

用 pnpm update 升级到最新版本（或重新 add 以获取更新的 git 引用）：

```sh
dsh plugin --profile web update dsh-model-reasoning
# 或，如果依赖 spec 被固定：dsh plugin --profile web add dsh-model-reasoning
```

然后**重启 `dsh web`** 以加载新的客户端 bundle。

### 卸载

```sh
dsh plugin --profile web remove dsh-model-reasoning
```

这会同时移除依赖和它在 `web` profile 中的 bundle 层。重启 `dsh web` 后该设置项消失。

## 目录结构

```
cordis.patch.yml                # bundle 层：挂载 client-modules 服务可发现的条目（dsh.client 清单）
package.json                    # dsh.bundle（patch）+ dsh.client（web）+ exports["./client"]
tsdown.config.ts                # 自包含构建：node 半区 + 模块表客户端 bundle
src/index.ts                    # host apply（空操作）
src/client/index.ts             # client apply：settingsScope.bind(llm-pi-ai) + 注册 settings.section
src/client/ProviderParamsSection.tsx  # 设置页（路由 → 参数分组页签 → 各编辑器）
src/client/params.ts            # 受管字段注册表：取值域、默认值、镜像 host 的校验器、
                                # 草稿模型、最小 op 差异引擎
src/client/styles.ts            # 设计 token 样式（--dsw-alias-*）+ 注入
src/client/locales.ts           # 中英文案
tests/params.test.ts            # 纯逻辑注册表的单测
```

## 构建与测试

```sh
npm install
npm run bundle       # 产出 lib/index.js + lib/client.js
npm test             # params.ts 单测（node:test 直接执行 TypeScript）
pnpm release:check   # 发布门禁：文档/变更日志/标签/工作区/构建/仓库 全部通过才可发布
npm publish          # 先跑门禁（prepack/prepublishOnly），发布后由 postpublish 验证线上版本
```

bundle 把平台包（`react`、`@deepseek-ai/cordis`、`@deepseek-ai/dsh-client-*`）
保持为外部依赖——它们在运行时从 loader 的模块表解析；其余全部内联。

## 说明 / 限制

- 只有携带显式 `models` 列表的路由才提供模型级编辑器（客户端无法触达已安装目录）；
  所有路由的路由级参数组始终可编辑。通过 `modelOverrides` 定制目录模型属于后续计划。
- 凭据管理（`apiKeyEnv`）、`displayName`、`baseURL`、协议（`api`）和模型列表结构
  仍归内置 **Models** 页管理；本插件不做重复建设。
- 线上拼写默认等于等级名；如需改线上的拼写（如 `max: ultra`），可在 `settings.yaml`
  中直接编辑该模型。
- 上游已移除的遗留路由级键（`provider`、`maxRetries`、`maxRetryDelayMs`）本插件
  绝不写入。
- **设置项导航图标由壳分配，不由插件分配。** 内置 `ui-settings-general` 的
  `SettingsRoot.tsx` `navIcon(id)` 只映射已知 id，其余 id（包括本项的
  `provider-params`）一律回退为齿轮。等 DSH 开放按 section 指定图标的能力后，为
  该项目使用 `dsh-client-ui-primitives` 的 `IconThinkOutline16`。

## 许可证

[MIT](LICENSE)

## 参与贡献

参见 [CONTRIBUTING.md](CONTRIBUTING.md)（开发与发布检查清单）和
[CHANGELOG.md](CHANGELOG.md)（版本历史）。
