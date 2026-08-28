# dsh-ego-lite — 让 Agent 驱动你本机的官方 ego lite

把官方 [ego lite](https://github.com/CitroLabs/ego-lite) 接进 DeepSeek Harness：**46 个结构化工具**（44 个 `ego_*` + 2 个浏览器驱动搜索）驱动浏览器，agent 在**独立任务空间**里复用你的登录态干活，不与你的日常浏览互相打扰。

- **官方 App 引擎优先**：直接驱动本机已安装的 ego lite App，vendored 运行时仅作无 App 环境兜底
- **官方 skill 全对齐**：ego-skills/ego-browser（SKILL.md v1.2.3）的 ~41 个 helper 全部固化为结构化工具（41/41），正确性由代码保证而非模型临场拼脚本
- **多会话隔离**（v0.9.4）：多个 DSH 对话并行干活，空间路由按会话隔离，互不看串
- **AI Mode 搜索**：`web_ai_search` 返回 Google AI 合成摘要 + 引用链接，`web_search_plain` 纯链接更快

> 本项目是一次面向个人使用的二改（fork-and-rework，**不向上游提交 PR**），基于 [Fisfzy/dsh-ego-browser](https://github.com/Fisfzy/dsh-ego-browser) v0.8.0（插件骨架与工具层基础）与官方 ego lite 内置 ego-browser skill（生命周期纪律与方法论来源），双上游均为 MIT。包内 settings 命名空间保持 `ego-browser`，既有配置无缝沿用。

## 快速开始

| 要求 | 说明 |
|---|---|
| Node ≥ 22 | harness 环境自带 |
| 官方 ego lite App（推荐） | macOS/Windows 桌面版装好并完成 onboarding 即可 |
| 或 Chrome / Chromium / Brave / Edge | 仅 vendored 兜底引擎需要；自动发现或 `chromePath` 指定 |

```sh
dshx install ego-browser <ego-browser.tgz>     # tarball 或 git URL 均可
dshx list                                      # 应显示：[on] ego-browser
```

装好后无需配置：`engineMode` 默认 `auto`，探测到官方 App 就用官方 App。之后正常对话即可——agent 会 `ego_space_open` 开空间、干活、`ego_space_close` 收尾。

## 多会话空间隔离（v0.9.4）

DSH harness 天然支持多个对话并行干活，浏览器只有一份。v0.9.3 及以前，「当前空间」是**进程级单槽**：A 会话 open 之后，B 会话不带 `space` 参数的调用会静默落到 A 的空间——导航写进别人的页面、A 关闭空间后 B 莫名报 `no active task space`。v0.9.4 起按会话隔离：

- **per-agent 空间路由**：每个会话（`exec.agent`）持有独立的「当前空间」槽位，互不可见；不带 `space` 的调用只回退到**本会话**最近 open/选中的空间，不存在可被别的会话污染的隐式全局状态。
- **落点自检**：所有按空间路由的工具在返回体携带 `space: {id, name}`——每次调用都能确认真实落点，杜绝「返回 ok 但写错地方」的静默失败。
- **per-agent 搜索空间**：`web_ai_search` / `web_search_plain` 的默认空间按会话命名（`web-search@<agent>`），互不复用、也不再污染会话路由；用完自动收尾。
- **fail-closed 而非 fail-wrong**：没有可用空间时按官方语义明确报错（`no active task space` / `Task space not selected`），绝不静默猜一个别人的空间。`ego_script` / `ego_cli` 裸脚本需在脚本内 `await taskSpaces.useOrCreate(<name>)` 自行绑定。
- **同名空间是全局的**：任务空间名跨会话共享，两个会话 open 同名会落到/争抢同一空间。跨会话并行时，优先把 `ego_space_open` 返回的数字 `id` 作为后续调用的 `space` 参数。
- 全局互斥锁保持不变（同一浏览器实例同一时刻只服务一次工具调用）——隔离的是「路由」，串行化的是「执行」。

## 工具全景（44 个 `ego_*` + 2 个搜索，完整索引见 `ego_help`）

| 类别 | 工具 |
|---|---|
| 任务空间 | `ego_space_open`（返回数字 `id`，跨会话建议用 id 定位） `ego_space_close` `ego_status` |
| 空间控制权 | `ego_space_list` `ego_space_claim` `ego_space_handoff` `ego_space_takeover` `ego_space_wait_control` |
| 标签页 | `ego_tab_list` `ego_tab_switch` `ego_tab_close` |
| 页面读取 | `ego_snapshot`（语义树） `ego_page_info` `ego_read_element` |
| 导航/等待 | `ego_navigate`（复用 tab） `ego_wait` `ego_wait_for_selector` `ego_wait_for_url` `ego_wait_for_response` `ego_wait_page`（load/networkidle） |
| 交互 | `ego_click` `ego_fill` `ego_hover` `ego_drag` `ego_select` `ego_check` `ego_key` `ego_dispatch_key` `ego_scroll` `ego_scroll_to_bottom` |
| 执行/调试 | `ego_js`（页面求值） `ego_cdp`（原始 CDP） `ego_cli`（任意 heredoc） `ego_script`（多步脚本） |
| 输出 | `ego_screenshot`（整页 + 元素级裁剪） `ego_download` `ego_upload` |
| 会话/安全 | `ego_auth_flush`（登录落盘） `ego_captcha` `ego_dialog` |
| 站点经验包 | `ego_site_tool`（官方 learnings：google / github / x-com） |
| 元工具 | `ego_help` `ego_doctor` `ego_http` |
| AI 搜索 | `web_ai_search` `web_search_plain`（见下节） |

## 浏览器驱动搜索

用真浏览器换取免费 AI 合成摘要 + 引用，取代廉价 HTTP 检索；与所有 `ego_*` 工具同引擎、同锁、可交错使用。

| 工具 | 说明 |
|---|---|
| `web_ai_search` | 触发 Google AI Mode（`udm=50`），返回**摘要 + 引用一起**（markdown `[1][2][3]`）。自动处理异步渲染、consent/区域墙与重试；`queries` 数组一次搜多条（语言跟随查询内容，不硬编码区域）。需要「摘要 + 引用」时优先用它。 |
| `web_search_plain` | 纯 Google 结果链接，无 AI 合成，更快更轻。 |

机制上只借鉴 `udm=50` 触发与完成检测的思想，不搬上游实现；引用 DOM 固定 + 多级兜底（固定卡片选择器 → 内联锚点 → 全量解码外链），引用可能变少但永不丢。

## 引擎选择（`engineMode`）

| 值 | 行为 |
|---|---|
| `auto`（默认） | 探测到官方 ego lite App（`~/.local/bin/ego-browser` 或 App bundle 内 Helpers）→ 用之；否则回退 vendored |
| `app` | 强制官方 App |
| `vendored` | 强制自带运行时（Linux 服务器 / Docker / 无 App 场景） |

两引擎能力差异矩阵见 [docs/APP-COMPAT.md](docs/APP-COMPAT.md)：app flavor 缺失的 facade 由 `src/app-facades.ts` 兼容预置层补齐（守卫式安装，官方未来原生绑定时自动让位）。

## 配置项

| 键 | 说明 |
|---|---|
| `engineMode` | `auto` / `app` / `vendored`，见上表 |
| `execSession` | app 引擎执行通道：默认每次 `-e` 求值（~0.4s 往返）；`persistent` 为 opt-in 实验性 REPL |
| `egoCliArgs` | 追加到 `ego-browser nodejs` 的自定义参数（白名单过滤） |
| `chromePath` / `chromeArgs` | vendored 引擎的 Chrome 路径与附加启动参数 |

## 任务空间生命周期（重要纪律）

继承官方 skill 并固化为工具约束：

- 一个用户目标 = 一个任务空间；同一目标的追问/纠错/验收**必须复用**原空间。
- 目标完成必须 `ego_space_close` 收尾，默认 `keep=false` 直接关页面，不留残留。
- 仅三种情况允许 `keep=true`：用户明确要求保留现场；需用户在该页手动操作（登录/验证码）；结果无法以文件/摘要交付。「访问过」「截图过」不算理由。
- 需要保留时先关 scratch 标签页，只留值得给用户看的页。

## 已知限制

- **大返回值**：`ego_js` / `ego_script` 走哨兵 JSON 通道，~1MB 级 payload 会打穿协议（输出截断、哨兵丢失）。大结果写文件再带回路径。
- **官方 learnings 选择器会过时**：`ego_site_tool` 是官方经验包的忠实载体，包内选择器随站点改版失效（如 Google 结果页已迁移）。提取为空时改用 `ego_snapshot` / `ego_js` 直接读页面。
- **programmatic blob 下载**：app flavor 下 App 可能静默吞掉纯程序化触发的 blob 下载（官方行为）；按钮点击、导航 attachment 等真实下载由 `ego_download` 的 Downloads 轮询兜底可靠捕获。

## 工作原理

- **工具层**：每个工具把参数拼成 JS 脚本；app 引擎经 `[node, egoBin, 'nodejs', '-e', script]` 直执行（vendored 经 stdin heredoc），结果以哨兵行回传解析（stdout/stderr 双路兜底）。所有工具经进程内互斥锁串行化，空间路由按会话隔离（见上）。
- **兼容预置层**：app flavor 下脚本前置 `APP_FACADE_PRELUDE`，重建 `page/browser/taskSpaces/site` 命名空间与完整 locator 表面，并把实测发现的官方契约偏差（截图对象形态、`wait()` 秒制歧义等）修在层内。
- **卸载**：vendored 引擎 fire-and-forget `--stop` 清场；app 引擎不动用户的浏览器（那是用户自己的 App）。

## 与上游、官方 skill 的关系

**与上游 Fisfzy/dsh-ego-browser v0.8.x 的核心分歧**：

| | 上游 v0.8.x | 本项目 |
|---|---|---|
| 浏览器来源 | 自带 vendored 运行时 | 优先驱动本机官方 ego lite App，vendored 仅兜底 |
| 实时观察窗 | 自带 SSE/FFmpeg 推流前端 | 移除——「看得见」由官方 App 窗口承担 |
| 生命周期纪律 | 未强制 | 对齐官方 skill：一个目标一个空间、用完必关 |

**与官方 ego-browser skill 的关系**：官方以提示词教 agent 现场拼 heredoc 脚本，每个能力每轮都要临场写对；本项目把同一套能力固化为结构化工具（41/41 全覆盖），并叠加四层稳定性保障——串行互斥锁、瞬态专属重试（仅已知冷启动签名）、契约漂移免疫（官方文档与现实的偏差全部修进兼容层）、参数安全白名单。架构与防冲突规范见 [docs/ARCH.md](docs/ARCH.md)。

## 开发

源码在 `src/`（TypeScript），构建产物在 `lib/index.js`。测试体系 vitest（118 用例，含 per-agent 空间隔离与搜索空间语义的防回归断言）。

```sh
npm run typecheck   # tsc 类型门禁
npm test            # vitest 单元测试
npm run build       # tsdown 单产物 lib/index.js
```

> 直接改 `src/`，构建后提交产物。各版本变更见 [CHANGELOG.md](CHANGELOG.md)。

## 许可与署名

插件本体 MIT，承袭上游 Fisfzy/dsh-ego-browser。vendored 兜底运行时嵌入 ego-lite 的 MIT 代码（本地改动见 [runtime/PATCHES.md](runtime/PATCHES.md)）。设计方法论致谢官方 ego-skills/ego-browser skill。详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
