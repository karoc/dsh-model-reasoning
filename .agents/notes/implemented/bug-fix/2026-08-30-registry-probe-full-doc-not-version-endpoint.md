# Agent Note: registry-probe-full-doc-not-version-endpoint

Status: implemented

## Problem

v0.2.2 发布成功（registry 权威状态：versions 含 0.2.2、dist-tags.latest=0.2.2），但 postpublish 检查 14 次轮询全部"not visible"，npm publish 以退出码 1 结束，用户看到报错。排查发现 registry 的版本端点 `/<pkg>/<version>` 对 install-v1 accept header 间歇性返回 406（对早已发布的 0.2.1 也会），检查脚本把 406 当"未同步"，42s 窗口全程踩中。更危险的是 release-check 用同一探测方式：已发布版本可能被误读为"安全可发"，无法拦截重复发版。

## Decision

两个发布脚本的 registry 探测全部改为读取全量包文档 `https://registry.npmjs.org/<pkg>`（无 accept header），以 `versions[<version>]` 是否存在为判据。post-publish-check.mjs：`fetchIndexDoc()` 轮询（20×3s ≈ 60s）直到 `doc.versions[version]` 出现，dist-tags 与 tarball 检查改用 `versionDoc`（即 `doc.versions[version]`）的 `dist.tarball`；release-check.mjs：单次拉全量文档，`versions[version]` 存在即判定"已发布，bump 版本"，404/网络失败仍视为"未发布/不可达"。版本端点 `/<pkg>/<version>` + `accept: application/vnd.npm.install-v1+json` 从此不再用于任何探测——该组合对已发布版本也会间歇性返回 406（dsh-model-reasoning 0.2.2 发布后 8 连测中出现 406，随后同请求 8/8 变 200），与索引传播窗口叠加造成 42s 全程误报。此修复只改仓库内脚本（scripts/ 不在 npm files 白名单），不需要发新版本，0.2.2 保持线上现状。
## Alternatives considered

**继续轮询版本端点但去掉 install-v1 accept header**：被否决——406 是间歇性的（同一请求序列里 200/406 交替出现），去掉 header 也可能偶发非 200，而失败方向（把已发布误判为未发布）最危险，不能留概率。
**保持版本端点 + 加大轮询次数**：被否决——轮询时长治标不治本，406 意味着探测信号本身不可靠，且 release-check（单次探测）无轮询可加。
**直接信任 npm publish 的退出码、删掉 postpublish 检查**：被否决——脚本的职责就是"上传后独立确认"，删除会退回"静默失败也算成功"的旧问题。
## Consequences

代价：全量包文档比版本端点大（本包 ~几十 KB，可忽略）；release-check 与 post-publish-check 现在都解析完整 JSON 文档。收益：postpublish 不再误报（0.2.2 发布当场误报一次，npm publish 退出码 1 但包已上线）；release-check 的"已发布"判定从概率性变确定——修复前它可能放行对已发布版本的重复发布。跟进义务：下次发版（0.2.3+）的 CHANGELOG 已含 Unreleased 条目说明此修复；若 npm registry 未来改变全量文档端点行为，需回归验证两个脚本。

