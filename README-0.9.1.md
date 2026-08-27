# dsh-ego-lite v0.9.1 — 浏览器驱动搜索：Google AI Mode（`web_ai_search` / `web_search_plain`）

> 版本：**v0.9.1** ｜ 分支：`feat/web-search-ai` ｜ 提交：`9d30b43`
> 变更范围：`v0.9.0(39b1189)..v0.9.1` 共 1 个提交，6 文件 / +785 −3。

## 一句话

在原有 32 个 `ego_*` 工具之上，新增一对**浏览器驱动搜索**工具 `web_ai_search` 与 `web_search_plain`，用来**取代对 HTTP 型 `web_search` 的依赖**：用真浏览器换取免费的 Google AI Mode 合成摘要，并把「摘要 + 引用链接」一起返回。

## 为什么做这件事

现状的问题：DSH 自带的 `web_search`（`@deepseek-ai/dsh-tool-web`）是 **API/HTTP 检索**，不渲染 JS、不做 AI 合成，只能给出链接列表，拿不到 AI 总结过的答案。而本机已装有官方 **ego lite App**、`dsh-ego-lite` 又能驱动它——用真浏览器打开 `google.com/search?…&udm=50` 就能触发 **Google AI Mode**，把几十个来源合成成**一份带引用的 AI 答案**。

用户预期：换取「免费 AI 搜索 + 总结内容」的代价只是**一点额外的开销**——这是划算的。本项目**抽走机制、不搬实现**（不复刻 python-google-ai-mode-skill 的 Python/Patchright 重链路），直接复用本插件已有的引擎 / 互斥锁 / 哨兵解析。

## 新增能力

### `web_ai_search` —— Google AI Mode 合成搜索

- 打开 `https://www.google.com/search?q=<encode>&udm=50`，**等待异步合成完成**，抽取 **AI 摘要 + 引用链接**。
- 返回：`{ ok, answer, sources[], markdown }`——摘要与 `[1][2][3]` 引用**一起**给定，markdown 可直接进入上下文。
- 自动处理：异步渲染（轮询等待）、Google **consent / 区域墙**、瞬态失败重试。
- 多语言 / 多区域：`queries` 数组一次搜多条，语言跟随查询内容（例如 `無職転生` 可同时搜 `zh-CN` 与 `ja-JP`）。

### `web_search_plain` —— 普通结果链接列表

- 触发普通 Google 搜索，返回**纯链接列表**（标题 + URL），不做 AI 合成。
- 适合只需要「去哪些页面取材」、不需要总结的场景；比 AI Mode 更快更省。

## 设计要点（决策记录）

| 决策 | 说明 |
|---|---|
| **摘要 + 引用一起返回** | 不只要总结，还要 `[1][2][3]` 引用锚定来源，避免 AI 答案「无据可查」。 |
| **不加 `hl`/`en`/`gl` 区域兜底** | 语言跟随查询内容，不强塞区域参数；跨语言（`zh`+`ja`）用 `queries` 数组覆盖。 |
| **任务空间复用** | 统一用 `web-search` 空间跑搜索；`web_ai_search` 结束会把 `spaceTracker.selected` 指向该空间，遵循「一个目标一个空间」纪律。 |
| **Path A：并存 + 引导** | 新增轻量搜索组件**盖在**大插件之上，复用引擎/锁/哨兵；**不删除** `@deepseek-ai/dsh-tool-web`，HTTP 型 `web_search` 留作更省开销的廉价回退。 |
| **抽走机制，不搬实现** | 不复刻 Python/Patchright 重链路，不吃进参考项目的 Python 运行时代价；只取 `udm=50` 触发 + 完成判定 + 提取的思想。 |

## 架构落点

- **新增 `src/ai-search.ts`**（293 行）：
  - `buildAiSearchUrl(query,{base})` → `…search?q=<percent-encoded>&udm=50`，CJK 正确编码、不强制 `hl/gl`。
  - `deriveSearchMarkdown(answer,sources)` → 摘要 + `[1][2][3]` 引用一起，纯函数可测。
  - 浏览器内脚本字符串常量 `AI_POLL_FN` / `AI_CONSENT_FN` / `AI_EXTRACT_FN` / `PLAIN_EXTRACT_FN`。
  - `buildAiSearchScript` / `buildPlainSearchScript` → 经 `useSpace` + `ensureRealTab` 拼出最终脚本。
  - 常量 `SEARCH_SPACE='web-search'`，`AI_SEARCH_TIMEOUT_MS=40_000`。
- **改 `src/index.ts`**：`registerActionTools` 追加 `reg(t({name:'web_ai_search'}))` 与 `web_search_plain`；`web_ai_search` 用 `buildAiSearchScript`，`afterExecute` 把 `cfg.spaceTracker.selected` 指向 `args.space || SEARCH_SPACE`。两者复用 `useSpace`/`ensureRealTab`。
- **改 `src/help.ts`**：`EGO_HELP_INDEX` 新增 `'ai-search'` 主题，`tools` 列表追加两工具（key 含连字符需引号包裹，避免 TS1005）。
- **新增 `tests/ai-search.test.ts`**（156 行）：URL/CJK 编码、markdown 摘要+引用、4 个 `new Function` parseOk、buildAi/PlainScript 行为。

## 关键坑与修复

- **`+N` 泄漏进引用标题**：实机运行发现摘要里的引用 title 会带出 `+2`。**根因**：正则 `^ (.*?) (\s*\+\d+)? \s* $` 里的 `.` 不匹配 `\n`，而真实品牌标题是多行（如 `Medium\n·Hashbyt | AI-First Frontend & UI/UX SaaS Partner\n +2`），`match()` 返回 `null` 致 `+N` 泄漏。**修复**：`src/ai-search.ts` 把 `(.*?)` 改为 `([\s\S]*?)`，跨行匹配。（此前疑虑的「双转义」是粘贴产物，非源码 bug。）
- **consent / 区域墙**：首次渲染既可能出完整 AI 答案，也可能弹 consent/重定向到 `.hk` 墙。工具必须**等待完成 + 处理 consent + 重试**，不能依赖首屏就绪。
- **app 引擎输出走 stderr**：哨兵解析已是 stdout 优先、stderr 回退，本组件复用该机制。

## 质量门（全绿）

- `tsc` exit 0。
- `vitest` **78/78**（原 76 + 新增 16 含 2 个 `AI_EXTRACT_FN` 多行标题回归用例）。
- `tsdown` 重建 `lib/index.js`（116.14 kB），已含 `web_ai_search`×5 / `web_search_plain`×4 / `udm=50` / `"web-search"` / 引用选择器 `WBgIic`×2。
- **实机端到端验证通过**：首轮实跑 `ok:true`，抽出完整 Next.js 15 答案（异步等待 11.6s，检测到 `AI 模式对话` 标题）；引用抽取单独跑返回 `pinned:9`（9 个唯一来源：Medium / Next.js / WorkOS / YouTube 等）。

## 使用

```text
# 需要「AI 摘要 + 引用」→ 优先 web_ai_search
web_ai_search({ queries: ['Next.js 15 App Router best practices 2026'] })

# 只需要「去哪些页面取材」→ 用 web_search_plain
web_search_plain({ queries: ['無職転生 アニメ 評価'] })
```

> 关联：本文件为 v0.9.1 **发行说明**；详细入口、能力矩阵与稳定性论证见主 [`README.md`](./README.md) 与 [`docs/APP-COMPAT.md`](./docs/APP-COMPAT.md)。要全过程改动记录见 [`CHANGELOG.md`](./CHANGELOG.md) 的 `[v0.9.1]`。
