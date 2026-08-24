# Agent Note: registry-probe-via-fetch

Status: implemented

## Problem

用户执行 npm publish 发布 0.2.0 时日志喷出三处 E404 错误块（prepublishOnly 门禁探测 ×1、prepack 门禁探测 ×1、postpublish 轮询期索引未同步 ×多次），流程实际成功却呈现「满屏错误 + ✅」的矛盾信号。根因有二：npm CLI 对不存在的版本必打 9 行 E404 块；且 Node 的 execSync 默认把子进程 stderr 直接回显到父进程 stderr，所以即使脚本 try/catch 吞掉失败，错误块照样出现在日志里。这正是 dsh-kanban 0.2.0 的同款事故，dsh-plugin-development 技能 §6 已有处方。

## Decision

两个脚本的全部 registry 读操作改用 Node 内建 fetch 直查 https://registry.npmjs.org：release-check 第 8 项仅把 HTTP 200 判为「已发布→阻塞」，404/网络失败打印 `is NOT published yet — safe to publish` 或 `registry unreachable — skipping`；post-publish-check 的可见性轮询每轮只打一行进度（retry N/14），dist-tags 改走 `/-/package/<name>/dist-tags` 端点，tarball URL 取自 version doc 的 dist.tarball、字节流经 fetch 拉取后通过 stdin 喂给 tar -tzf -（tar 是唯一保留的子进程）。node --check 双脚本通过，并用线上真实 0.2.0 完成实测：post-publish-check 三项全绿零噪音。
## Alternatives considered

**保留 npm view 但 execSync 加 stdio:['ignore','pipe','pipe'] 静音**：能消音但仍是子进程（慢、留 ~/.npm 日志、错误对象里藏着语义需要再翻译）——输给 fetch 直查一步到位；**用 npm CLI 的 --json + 2>/dev/null**：同样治标且依赖 npm 内部输出格式——输给标准 HTTP 状态码判定。
## Consequences

换来：一次发布的 registry 相关输出从 ~5 块 45+ 行 E404 变成 2 行语义化进度；沙箱 EROFS 日志副作用消失。代价：脚本直连 registry.npmjs.org，走会话网络路径（本机代理 41008 实测可用）；实测中出现过一轮 14 连 miss 的瞬时抖动，重试机制正确吸收。v0.2.0 已带噪发布无法撤回，修复随 v0.2.1 上线；用户需再执行一次 npm publish 发布这个工具版本。

