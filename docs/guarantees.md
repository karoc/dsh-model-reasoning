# Negative guarantees (pinned by test titles)

This plugin **writes the user's model configuration**, so its "never writes X"
and "rejects Y" promises are the part that must not drift. The third column is
the test title that pins each row: `scripts/check-guarantees.mjs` fails
`npm test` when a title disappears, so a guarantee cannot be dropped silently
and a test cannot be deleted while its promise stays in the docs.

| id | guarantee | pinned by |
|---|---|---|
| G1 | 草稿里被**取消**的覆盖项发 `unset`，**不写默认值回声**（不把用户的设置改成默认） | `unsets a removed override instead of writing a default echo` |
| G2 | **无差异**的草稿产生**零个** op（不会为了"保存"而写盘） | `emits nothing for a no-diff draft` |
| G3 | 路由相对 op **必须**带 `providers.<routeKey>` 前缀（不会误写到别的路由） | `prefixes every route-relative op with providers.<routeKey>` |
| G4 | `unset` op 也被同样的锚定规则约束（不会因为"删除"就绕过锚点） | `anchors unset ops the same way` |
| G5 | 数值字段里的**非数字文本被拒**（不写出非法配置） | `rejects non-numeric text in numeric fields` |
| G6 | **负 retries / 零空闲超时 / 小数容量**被拒 | `rejects negative retries, zero idle timeout, and fractional capacities` |
| G7 | 模型级容量参数拒绝 **0 / 负数 / 小数** | `validateModelParams rejects zero/negative/fractional caps` |
| G8 | `jitterRatio` 被钳在 **[0, 1]**（不写出越界退避） | `bounds jitterRatio to [0, 1]` |
| G9 | `initialDelayMs <= maxDelayMs` **仅在两者都给出时**才强制（不凭空添加约束） | `enforces initialDelayMs <= maxDelayMs only when both are given` |
| G10 | 与全默认**逐字相等**的 retry 策略折叠为**无操作**（不写冗余） | `collapses an exact-full-default retry policy to no op` |
| G11 | `always` 模式**丢弃** normal-only 字段（不把不适用字段写进去） | `always mode drops normal-only fields` |
| G12 | `buildModelEntry` 在草稿 unset 时**清除键**（不留下旧值） | `buildModelEntry clears keys when the draft unsets them` |
| G13 | `thinkingBudgets` 稀疏写入，清空时发 `unset`（不留空壳对象） | `writes thinkingBudgets sparsely and unsets when emptied` |
