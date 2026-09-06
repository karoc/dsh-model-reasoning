# Agent Note: brand-standard-smoothly

Status: implemented

## Problem

v0.2.3 刚把品牌定为 "DSH Smoothly Model Reasoning (DSH SMR)"，用户随后给出新品牌规范（Smoothly / 思磨力 / Smoothly MR / 思磨力提供方参数），要求整体落地到插件所有用户可见面，并明确了技术标识符不动、bump 0.2.4 的约束。

## Decision

2026-09-06 提交 a135e09（v0.2.4，已推 origin/main）。品牌规范落地：品牌英文 **Smoothly**、品牌中文 **思磨力**、英文产品名 **Smoothly Model Reasoning**（简称 **Smoothly MR**，取代 v0.2.3 的 "DSH SMR"）、中文产品名 **思磨力提供方参数**。用户可见面全部按新品牌：设置导航 en='Smoothly MR' / zh='思磨力提供方参数'，页标题 en='Smoothly Model Reasoning (Smoothly MR)' / zh='思磨力提供方参数'（src/client/locales.ts）；README.md / README.zh.md 各加品牌规范表并更新正文所有「提供方参数 / Provider parameters」引用；package.json description 前缀 'Smoothly Model Reasoning (Smoothly MR) — 思磨力提供方参数'，keywords 增 smoothly / smoothly-mr / 思磨力，version bump 0.2.4（package-lock 根版本同步）；CHANGELOG 新增 0.2.4 条目注明取代旧名。技术标识符刻意不动：npm 包名 dsh-model-reasoning、插件运行时 ID model-reasoning、locale namespace provider-params、settings.section id、style tag 标记、tsdown ID——已装 profile、安装命令、构建链路零变更。旧字符串清理范围是源码与现行文档；CHANGELOG 历史条目（0.2.3 的 DSH SMR）保留原样。lib/ 是 gitignored 构建产物，pnpm bundle 重建后由 dev server HMR 自动生效；tag v0.2.4 与 npm publish 留待用户发布。
## Alternatives considered

- **改 npm 包名 / 插件运行时 ID 为新品牌名（如 smoothly-mr）**：用户明确否决。这会破坏已安装 profile（cordis patch 行、`/plugins/<id>` 路由、client-modules 启动扫描）、改掉所有安装文档命令，而技术标识符与用户可见品牌解耦本就是 DSH 外部插件既定模式（skill §6）——只改品牌零风险，改名全链条风险。
- **中文简称取「思磨力」**：否决。用户选择字面方案：中文一切场合（含设置导航）用「思磨力提供方参数」，「思磨力」只作为品牌词与 Smoothly 成对出现（品牌表）。
- **0.2.4 不打版本只改文档**：否决。仓库惯例（v0.2.3 同款）是品牌类变更必须 bump + CHANGELOG 条目同步，tag 留到实际发布时打。
## Consequences

买到的：品牌单一来源（README 双语品牌规范表）贯穿 UI 文案、文档、npm metadata；设置导航与文档引用一致（「思磨力提供方参数 / Smoothly MR」），不再出现 DSH SMR 与 Smoothly MR 混用。代价：0.2.4 已 bump 但 tag v0.2.4 未打、npm 未发布（留给用户发布流程）；英文导航从功能名 "Provider parameters" 换成品牌简称 "Smoothly MR"，依赖旧导航文案的自动化/验收脚本需同步；CHANGELOG 历史条目保留两套品牌名（0.2.3 的 DSH SMR），沿革靠 0.2.4 条目说明。

