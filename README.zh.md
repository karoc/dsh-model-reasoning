# dsh-model-reasoning

[English](README.md) | 简体中文

[![npm version](https://img.shields.io/npm/v/dsh-model-reasoning.svg)](https://www.npmjs.com/package/dsh-model-reasoning)
[![npm downloads](https://img.shields.io/npm/dm/dsh-model-reasoning.svg)](https://www.npmjs.com/package/dsh-model-reasoning)
[![license MIT](https://img.shields.io/npm/l/dsh-model-reasoning.svg)](LICENSE)

一个**外部** DeepSeek Harness Web 客户端插件：新增一个设置页，用来为第三方（pi-ai）提供方配置**每个模型的思考等级（推理强度 / reasoning efforts）**。它写入与 `llm-pi-ai` 适配器读取完全相同的 `llm-pi-ai.providers.<route>.models[].reasoningEfforts`（以及路由级 `reasoning`）字段，因此 composer 的「推理等级」选择器和路由默认值无需任何额外改动即可生效。

为什么要做成外部插件：内置的 **Models** 设置表单刻意不暴露推理强度（它是按模型的能力），而给内置 `ui-settings-models` 包加字段会在官方下次发布时被覆盖。本包作为可安装的 **bundle** 交付，从不触碰仓库源码，官方更新无法覆盖它。

## 它新增了什么

一个放在内置 **Models** 页之后的新设置项 **「模型思考等级 / Model reasoning」**。对每个带有显式 `models` 列表的第三方提供方，你可以：

- 设置**路由默认思考等级**（`providers.<route>.reasoning`）；
- 对每个模型选择 **继承 / 不思考（`false`）/ 思考并选择等级集合**（`reasoningEfforts`），勾选标准等级 `off minimal low medium high xhigh max`。

### 自定义线上拼写（适配任意上游词汇）

每个被选中的等级都有一个**线上拼写（wire spelling）**字段（默认等于等级名）。修改它即可重映射该等级发到上游的值——例如把模型最高档叫 Ultra 时配 `max → ultra`，或 `high → turbo`。`off` 可以发送空值（默认）或自定义值。这是在**不等待适配器更新**的情况下适配模型思考词汇的受支持方式。

> ⚠️ DSH **不支持**发明新的等级名。pi-ai 的 schema 把 `reasoningEfforts` 的键固定为上面的七个等级（`z.dict(..., z.union(levels))`），解析时也只读取这些键，所以裸写 `ultra:` 键会在写入时被拒绝、在请求时被忽略。「Ultra」应通过重映射已有等级的线上拼写（`max: ultra`）来表达，而不是新增 `ultra` 键。

### 空状态

尚未配置任何第三方提供方时，页面会显示一张友好的占位卡片（而不是一个空洞的下拉框），提示你先添加自定义提供方，并指向 **设置 → 模型 → 添加自定义提供方**。它区分「完全没有提供方」和「有提供方但没有自定义模型列表」两种情况，并在设置文档加载时显示加载中 / 不可用提示。

写入路径使用官方的 `settings.mutate` RPC 并带 revision 冲突保护，并发修改会被拒绝而不是被静默覆盖。

## 安装

**前置要求：** 已安装带 `dsh` CLI 的 DeepSeek Harness，以及 [pnpm](https://pnpm.io)（`dsh plugin` 命令底层调用 pnpm）。这是一个可安装的 **bundle**——由 `dsh` 加载，不是当作库 import。

### 从 npm 安装（推荐）

包已发布到 npm，名为 `dsh-model-reasoning`：

```sh
dsh plugin --profile web add dsh-model-reasoning
```

这会安装预构建的 bundle 并把它追加到 `web` profile。然后**重启 `dsh web`**，打开 **设置 → 模型思考等级 / Model reasoning**。

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
cordis.patch.yml      # bundle 层：挂载 client-modules 服务可发现的条目（dsh.client 清单）
package.json          # dsh.bundle（patch）+ dsh.client（web）+ exports["./client"]
tsdown.config.ts      # 自包含构建：node 半区 + 模块表客户端 bundle
src/index.ts          # host apply（空操作）
src/client/index.ts   # client apply：settingsScope.bind(llm-pi-ai) + 注册 settings.section
src/client/ReasoningSection.tsx  # 设置页（路由 → 模型 → 思考等级编辑器）
src/client/styles.ts   # 设计 token 样式（--dsw-alias-*）+ 注入
src/client/locales.ts # 中英文文案
```

## 构建

```sh
pnpm install
pnpm bundle          # 产出 lib/index.js + lib/client.js
pnpm release:check   # 发布门禁：文档/变更日志/标签/工作区/构建/仓库 全部通过才可发布
pnpm publish         # 先跑门禁（prepack/prepublishOnly），发布后由 postpublish 验证线上版本
```

bundle 把平台包（`react`、`@deepseek-ai/cordis`、`@deepseek-ai/dsh-client-*`）保持为外部依赖——它们在运行时从 loader 的模块表解析；其余全部内联。

## 说明 / 限制

- 这里只能枚举带显式 `models` 列表的路由（客户端无法触达已安装的目录）。纯目录提供方保持使用内置目录的等级，并在 composer 选择器里选。
- 线上拼写默认等于等级名；如需改线上的拼写（如 `max: ultra`），可在 `settings.yaml` 中直接编辑该模型。
- **设置项导航图标由壳分配，不由插件分配。** 内置 `ui-settings-general` 的 `SettingsRoot.tsx` `navIcon(id)` 只映射已知 id（`models`、`agent-presets`、`plugins`），其余 id（包括本项的 `model-reasoning`）一律回退为齿轮。`settings.section` 注册没有 icon 字段，因此外部插件不改壳就无法设置图标。等 DSH 开放按 section 指定图标的能力（例如注册项增加 icon 选项）后，为该项目使用 `dsh-client-ui-primitives` 的 `IconThinkOutline16`。

## License

[MIT](LICENSE)

## 参与贡献

参见 [CONTRIBUTING.md](CONTRIBUTING.md)（开发与发布检查清单）和 [CHANGELOG.md](CHANGELOG.md)（版本历史）。
