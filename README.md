# dsh-ego-lite — 让 Agent 驱动你本机的官方 ego lite

> **dsh-ego-lite 是 DSH ⇄ 官方 ego lite 的结构化桥接层**：把 skill 层的提示词方法论固化成代码。同时是一次面向个人使用的二改（fork-and-rework，**不向上游提交 PR**），基于以下两个上游项目改造而成：
>
> 1. **[Fisfzy/dsh-ego-browser](https://github.com/Fisfzy/dsh-ego-browser)** v0.8.0 —— DSH 插件骨架、32 个 `ego_*` 工具层与执行引擎的基础（MIT）。
> 2. **[CitroLabs/ego-lite](https://github.com/CitroLabs/ego-lite)** 官方内置的 **ego-skills/ego-browser** skill（SKILL.md v1.2.3）—— 任务空间生命周期纪律与三工作流方法论的权威来源（MIT）。本插件把这套「提示词层」的能力固化成了结构化代码。
>
> 包名 **dsh-ego-lite**（GitHub 仓库同名）；插件内部的 settings 命名空间保持 `ego-browser` 不变，既有配置无缝沿用。

把 ego lite 接入 DeepSeek Harness：以 **32 个结构化 `ego_*` 工具**驱动浏览器，让 agent 在**独立的任务空间**里复用你的登录态干活，不与你的日常浏览互相打扰；并在此之上提供 **Google AI Mode 搜索**（`web_ai_search` / `web_search_plain`），用真浏览器换取免费 AI 合成摘要 + 引用。

## v0.9.0 方向变化

本分支与上游的核心分歧：

| | 上游 v0.8.x | 本项目 v0.9.0+ |
|---|---|---|
| 浏览器来源 | 自带 vendored 运行时（随包管理 Chromium 启动） | **优先驱动本机已安装的官方 ego lite App**，vendored 仅作无 App 环境兜底 |
| 实时观察窗 | 自带 SSE/FFmpeg 推流前端 + 监控窗接管 | **移除**——"看得见"由官方 ego lite App 窗口本身承担 |
| 生命周期纪律 | 未强制 | **对齐官方 skill**：一个目标一个任务空间、用完必关（`keep` 默认 `false`），不留残留页面 |

## 相对官方 ego-browser skill：全能力覆盖 + 稳定性增强

官方 App 内置的 ego-browser skill 以**提示词**形式教 agent 现场拼 heredoc 脚本——每个能力模型每轮都要临场写对。dsh-ego-lite 把同一套能力**固化为结构化工具**：能力全部覆盖（下表），且调用的正确性由代码保证：

| 官方 skill 能力（SKILL.md v1.2.3） | dsh-ego-lite 对应 |
|---|---|
| 任务空间全周期：`useOrCreateTaskSpace` / `completeTaskSpace({keep})` / 同目标复用与收尾纪律 | `ego_space_open` / `ego_space_close`（keep 政策直接内置：默认 false + 三种正当例外写入工具描述与 open 返回的 note 字段） |
| 空间清单与控制权交接五件套：`listTaskSpaces` / `claimTaskSpace` / `handOffTaskSpace` / `takeOverTaskSpace` / `waitForAgentControl`（v0.9.3 补齐） | `ego_space_list` / `ego_space_claim` / `ego_space_handoff` / `ego_space_takeover` / `ego_space_wait_control`——官方 ownership 语义照搬进工具描述（claim=转移+选中、handOff 必查 done/skipped、takeOver 仅限用户明确确认后、wait_control 只读阻塞且秒制换算毫秒制），且全部「只解析已存在空间、绝不顺手创建」 |
| 标签页级操作：`listTabs` / `switchTab` / `closeTab`（v0.9.3 补齐） | `ego_tab_list` / `ego_tab_switch` / `ego_tab_close`（targetId/url子串/标题子串/序号四种匹配） |
| 无限滚动：`scrollToBottomUntil`（v0.9.3 补齐） | `ego_scroll_to_bottom`——Node 层自实现循环，滚到底或等选择器出现，两引擎行为一致 |
| 等待族：`waitForLoad` / `waitForNetworkIdle`（v0.9.3 补齐） | `ego_wait_page`——load 轮询 readyState、networkidle 用资源数稳定窗口，确定性自实现，不赌 helper 签名 |
| 原始按键：`dispatchKey`（v0.9.3 补齐） | `ego_dispatch_key`——合成 KeyboardEvent 派发（key/code/keyCode 映射），免焦点 |
| 站点经验包 learnings：google / github / x-com + `siteSkills` / `runSiteTool`（v0.9.3 补齐） | `ego_site_tool`——官方经验包运行时的结构化载体（此前只有垫片没有工具面） |
| 语义工作流：`snapshotText()` → `@N` refs / `loc=` 选择器 | `ego_snapshot` + `ego_click/fill/hover/drag` 直吃 ref，无需模型理解快照协议 |
| 视觉工作流：`captureScreenshot()` + 坐标/键盘操作 | `ego_screenshot`（整页 + **元素级裁剪**，后者是 skill 都没有的）+ 坐标点击 |
| 直接 DOM / CDP 工作流：`js()` / `cdp()` | `ego_js` / `ego_cdp` / `ego_script`（多步脚本逃生舱） |
| 辅助函数面：click/doubleClick/hover/dragMouse、selectOption、uploadFile、wait 族、pressKey/typeText、serverFetch/browserFetch、drainEvents… | 全部有对应结构化工具；装机版绑定缺失的面（`selectOption` 不在全局面、元素截图不存在、`{path}` 截图契约漂移、`completeTaskSpace` 强制 `{keep}`）由 `APP_FACADE_PRELUDE` 兼容层补齐/修复 |

v0.9.3 起官方 SKILL.md 的 ~41 个 helper **全部有结构化工具对应**（41/41）。新增工具全部走「flat helper 优先、namespace 兜底」的双保险脚本（`src/space-control.ts`），官方 App 与 vendored 两引擎行为一致；滚动/等待类为确定性自实现，不赌 helper 签名。

**稳定性优于裸 skill 的四层保障：**

1. **串行互斥锁**：所有工具经进程内锁执行，杜绝并发调用争用同一浏览器。
2. **瞬态专属重试**：仅对已知冷启动瞬态签名（CDP channel not open、DevTools timeout 等）重试，真错误不吞不掩。
3. **契约漂移免疫**：skill 文档与现实 flavor 的每一处偏差都要 agent 当场踩坑；本插件已把实测发现的偏差全部修进兼容层（截图对象契约会崩→翻译为字符串形态、stdout/stderr 双路哨兵解析、`wait()` 秒制歧义→毫秒制自实现）。
4. **参数安全**：用户自定义 CLI 参数经白名单过滤（`--status/--stop/--open` 等危险子命令永不进入 argv）。

## 它解决什么问题

通用浏览器不是为 agent 设计的，而 Web 上大量交互（登录态、验证码、动态渲染、表单、需真人会话的站点）只有真浏览器能面对。ego lite 让 agent 用你已登录的浏览器而不打扰你；本项目把它接进 DSH：

- 每个用户目标一个**任务空间**（隔离 browsing context，继承登录态），后续追问自动复用；
- agent 全程结构化调用——导航、语义快照、点击填表、等待网络、截图取证——而不是猜选择器；
- 结果以 JSON 哨兵回传，错误统一归一，冷启动瞬态自动重试。

### 引擎选择（`engineMode`）

| 值 | 行为 |
|---|---|
| `auto`（默认） | 探测到官方 ego lite App（`~/.local/bin/ego-browser` 或 App bundle 内 Helpers）→ 用之；否则回退 vendored |
| `app` | 强制官方 App |
| `vendored` | 强制自带运行时（Linux 服务器 / Docker / 无 App 场景） |

官方 App 与 vendored 的能力差异矩阵见 [docs/APP-COMPAT.md](docs/APP-COMPAT.md)：app flavor 缺失的 facade 由 `src/app-facades.ts` 兼容预置层补齐（守卫式安装，官方未来原生绑定时自动让位）。

## 前置条件

| 要求 | 说明 |
|---|---|
| Node ≥ 22 | harness 环境自带 |
| 官方 ego lite App（推荐） | macOS/Windows 桌面版装好并完成 onboarding 即可 |
| 或任意 Chrome / Chromium / Brave / Edge | 仅 vendored 兜底引擎需要；自动发现或 `chromePath` 指定 |

## 安装

```sh
dshx install ego-browser <ego-browser.tgz>                             # tarball 或 git URL 均可
dshx list                                                # 应显示：[on] ego-browser
```

## 工具清单（32 个，前缀 `ego_`，完整索引见 `ego_help`）

| 类别 | 工具 |
|---|---|
| 任务空间 | `ego_space_open` `ego_space_close` `ego_status` |
| 页面读取 | `ego_snapshot`（语义树） `ego_page_info` `ego_read_element` |
| 导航/等待 | `ego_navigate`（复用 tab） `ego_wait` `ego_wait_for_selector` `ego_wait_for_url` `ego_wait_for_response` |
| 交互 | `ego_click` `ego_fill` `ego_hover` `ego_drag` `ego_select` `ego_check` `ego_key` `ego_scroll` |
| 执行/调试 | `ego_js`（页面求值） `ego_cdp`（原始 CDP） `ego_cli`（任意 heredoc） `ego_script`（多步脚本） |
| 输出 | `ego_screenshot` `ego_download` `ego_upload` |
| 会话/安全 | `ego_auth_flush`（登录落盘） `ego_captcha` `ego_dialog` |
| 元工具 | `ego_help` `ego_doctor` `ego_http` |
| AI 搜索 | `web_ai_search` `web_search_plain`（见下节） |

## 浏览器驱动搜索：Google AI Mode（`web_ai_search` / `web_search_plain`）

覆盖通用检索需求，**取代/引导**对廉价 HTTP `web_search` 的使用：一点点额外开销（真浏览器渲染），换来**免费的 Google AI 合成摘要 + 带引用链接**。两者都复用上述同一条引擎/互斥锁/任务空间链路，与所有 `ego_*` 工具完全兼容、可交错使用。

| 工具 | 说明 |
|---|---|
| `web_ai_search` | 触发 Google AI Mode（`google.com/search?…&udm=50`），返回**AI 合成摘要 + 引用链接一起**（markdown，`[1][2][3]` 引用）。自动处理异步渲染 + consent/区域墙 + 重试；多语言/多区域用 `queries` 数组一次搜多条。**需要「摘要 + 引用」时优先用它。** |
| `web_search_plain` | 纯 Google 结果链接（无 AI 合成），更快更轻，只要原始链接时用。 |

设计要点：

- **语言跟随查询内容**：不硬编码 `hl=en`/`gl=us` 区域兜底——搜索语言由查询本身决定（如 `["无职转生 动画", "無職転生 アニメ"]` 同时覆盖中/日两种区域）。
- **摘要 + 引用一起返回**，绝不只给摘要。引用 DOM 已固定（生产渲染实测），并带多级兜底：若固定卡片选择器漂移，退回内联品牌/标记锚点，再退全量解码外链——退化成更少的引用，但永不丢。
- **多空间纪律**：复用同一个任务空间（默认 `web-search`），针对用户目标复用；完成后 `ego_space_close` 收尾。
- **机制抽取、不搬实现**：只借鉴 `udm=50` 触发 + 完成检测的思想，不复制上游 python/Patchright 重实现。

## 任务空间生命周期（重要纪律）

继承官方 skill 并固化为工具约束：

- 一个用户目标 = 一个任务空间；同一目标的追问/纠错/验收**必须复用**原空间。
- 目标完成后必须 `ego_space_close` 收尾，**默认 `keep=false` 直接关闭页面**——不留做完任务的残留页面。
- 只有三种情况允许 `keep=true`：① 用户明确要求保留现场；② 需要用户在该页面上手动操作（登录/验证码）；③ 结果无法用文件/工件/摘要交付。「访问过页面」「截图验证过」不是理由。
- 需要保留时，先关掉 scratch 标签页，只留值得给用户看的页。

## 配置项

| 键 | 说明 |
|---|---|
| `engineMode` | `auto` / `app` / `vendored`，见上表 |
| `execSession` | app 引擎执行通道：默认每次 `-e` 求值（~0.4s 往返）；`persistent` opt-in 实验性 REPL |
| `egoCliArgs` | 追加到 `ego-browser nodejs` 的自定义参数（白名单过滤） |
| `chromePath` / `chromeArgs` | vendored 引擎的 Chrome 路径与附加启动参数 |

## 工作原理

- **工具层**：每个工具把参数拼成 JS 脚本；app 引擎经 `[node, egoBin, 'nodejs', '-e', script]` 直执行（vendored 经 stdin heredoc），结果以哨兵行回传解析（stdout/stderr 双路兜底）。所有 `ego_*` 经进程内互斥锁串行化。
- **兼容预置层**：app flavor 下脚本前置 `APP_FACADE_PRELUDE`，重建 `page/browser/taskSpaces/site` 命名空间与完整 locator 表面。
- **卸载**：vendored 引擎 fire-and-forget `--stop` 清场；app 引擎不动用户的浏览器（那是用户自己的 App）。

## 开发

源码在 `src/`（TypeScript），构建产物在 `lib/index.js`。

```sh
npm run typecheck   # tsc 类型门禁
npm test            # vitest 单元测试
npm run build       # tsdown 单产物 lib/index.js
```

> 直接改 `src/`，构建后提交产物。架构与防冲突规范见 [docs/ARCH.md](docs/ARCH.md)。

## 许可与署名

插件本体 MIT，承袭上游 Fisfzy/dsh-ego-browser。vendored 兜底运行时嵌入 ego-lite 的 MIT 代码（本地改动见 [runtime/PATCHES.md](runtime/PATCHES.md)）。设计方法论致谢官方 ego-skills/ego-browser skill。详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
