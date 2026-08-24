# Agent Note: per-model-capability-editing

Status: implemented

## Problem

前一版把「llm-pi-ai 的 models[] 条目支持 input/contextWindow/maxTokens」这一模型级能力漏掉了：除推理强度外所有参数都被做成路由级，导致混合提供方（如 text-only 与 vision 模型共存）只能用 defaultInput 一刀切回退，无法逐模型声明真实模态；同时作用范围徽标的说明文字与 hover tooltip 完全重复。用户明确指出这是设计错误而非文档问题。

## Decision

第一个页签改为「按模型 / Per model」（id permodel）：选中模型后编辑其自身声明的全部插件管辖维度——input 模态三态复选（清空即删除键回到继承）、contextWindow/maxTokens 数字（留空=继承回退）、既有推理强度编辑器。「应用到所有模型」升级为按维度勾选复制（ASPECTS: input/capacity/reasoning，默认仅 reasoning），未勾选维度保留各模型原值。params.ts 新增纯函数 modelParamsOf/buildModelEntry/validateModelParams（buildModelEntry 只合并 input/caps 两维、透传 id/name/reasoningEfforts；MODALITIES 规范序落盘），组件侧 mergedModel memo 把 effortDirty 与参数 diff 合并进既有 models 整数组写路径，stable() 键序无关比较防幻影脏。路由级四组保留「整条路由」徽标，tooltip 文案明确"schema 仅路由级定义"，且说明文字只存在于 tooltip（不再有旁边重复行）；「容量与预算」组的 default* 三项加 fallbackTitle 小标题标注回退语义。
## Alternatives considered

**维持「推理强度唯一可按模型」+ 路由徽标说明**：把 schema 能力当产品边界，被用户正确驳回——input 逐模型声明是真实需求而非过度设计——输给本次重构。**在四个路由级组里内嵌模型覆盖控件**：schema 不支持这些字段的模型级形态，造出写不进去的假 UI——输给诚实分组 + 徽标 tooltip 解释。**per-model 编辑也做双头管理 name 字段**：与内置 Models 页职责重叠无增益——输给只接管内置页没有的 input 与它编辑粒度不足的 context/maxTokens。**apply-to-all 无维度选择整模型复制**：会静默抹掉各模型的差异化声明——输给按维度勾选（默认仅推理）。
## Consequences

换来：混合模态/异构容量提供方可在单页完成逐模型声明；范围语义由徽标 tooltip 单一载体承载（重复可见文字已删）。代价：与内置 Models 页在 contextWindow/maxTokens 上形成双头写入（revision fencing 防静默丢失，README 已注明分工）；modelOverrides（目录路由的逐模型声明）仍缺位，目录路由用户暂无逐模型入口（backlog 卡片在案）；组件体积增长至 ~211kB bundle，仍远小于加载预算。

