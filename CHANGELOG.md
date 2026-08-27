# Changelog

所有对用户可见的变更集中在各版本号下。格式遵循 [Keep a Changelog](https://keepachangelog.com/)，版本语义遵循 [SemVer](http://semver.org/)。

## [Unreleased]

官方 ego lite App 引擎：优先驱动本机安装的官方 CLI（不再自带浏览器），vendored runtime 降级为无 App 环境的兜底。

### 身份与定位
- 项目更名 **dsh-ego-lite**（包名与 GitHub 仓库同步改名；内部 settings 命名空间保持 `ego-browser`，老配置无缝沿用）。本项目是一次面向个人使用的二改（**不向上游提交 PR**），同时基于两个上游：[Fisfzy/dsh-ego-browser](https://github.com/Fisfzy/dsh-ego-browser) v0.8.0（插件骨架/工具层基础）与官方 ego lite 内置 **ego-skills/ego-browser** skill（SKILL.md v1.2.3，生命周期纪律与工作流方法论来源）。README 重写：双上游署名、不提 PR 声明、「相对官方 skill 的全能力覆盖矩阵 + 四层稳定性论证」。

### 移除（Breaking）
- **实时观察窗/推流栈整体删除**：本分支定位转向"驱动用户本机官方 ego lite App"，"看得见"由官方 App 窗口本身承担。移除 `src/client/`（观察窗前端）、`src/worker/`（采集 worker）、`src/cast-server.ts`（`/api/ego/*` 路由）、`src/gateway.ts`（`/ego/api/*` 设置网关）、`src/ffmpeg-*.ts`（FFmpeg 安装/探测）及对应 10 个测试文件；设置键 `captureBackend/streamProfile/cdp*/ffmpeg*/githubMirror` 与遗留迁移键一并移除（持久化旧值被安全忽略）。包不再声明 `dsh.client` 入口与 react/dsh-client-* peer，构建收敛为单产物 `lib/index.js`。
- **任务空间生命周期纪律对齐官方 skill**：`ego_space_open/close` 描述、open 结果 `note` 字段与 `ego_help` 新增 `space` 主题均写明——目标完成必须 close，`keep` 默认 `false`，仅"用户明确要求保留 / 需人工在该页操作 / 结果无法以文件或摘要交付"三种情况可 `keep=true`。

### 新增 / 优化
- **双引擎架构**：新增引擎探测（`src/engine.ts`）——`~/.local/bin/ego-browser` 或 `ego lite.app` Framework helper 存在时走 **app 引擎**，脚本以 `nodejs -e <script>` argv 通道执行（实测含真实导航全程 ~0.5s，15 连发压测 0 失败、0 进程残留）；否则回退 vendored `runtime/ego-linux`。配置 `engineMode: auto|app|vendored` 可强制。
- **命名空间兼容层**（`src/app-facades.ts`）：官方 CLI 只绑扁平 helper（`useOrCreateTaskSpace/click/js/drainEvents…`），兼容预置层按需重建 vendored 式 `page./browser./taskSpaces.` 命名空间——Locator 全方法（selectOption 经 `js()` IIFE 模拟、元素状态读取经 `domOnce`）、毫秒制 `waitForSelector/URL/Response/Event` 轮询族（规避版本相关的 `wait()` 单位歧义）、download 事件适配 `{path/saveAs/suggestedFilename/url}`。guard 式安装，官方未来原生绑定命名空间时自动让位。
- **协议适配**：官方二进制把内嵌 Node 的全部 console 输出重定向到 stderr，哨兵解析改为 stdout 优先、stderr 回退；用户自定义 `ego-browser CLI 附加参数` 在 `-e` 通道照常追加。
- **截图契约修正**（实机测试发现）：装机版 `captureScreenshot` 实际只接受字符串路径，SKILL.md 文档化的 `{path}` 对象形式会在内部 `fs.writeFile` 处抛 `ERR_INVALID_ARG_TYPE`；兼容层将选项对象翻译为字符串形态、无 path 时走无参 tmp 形态，并补齐缺失的 `locator.screenshot({path})` 元素截图（scrollIntoView + CDP `Page.captureScreenshot` 视口裁剪 + base64 落盘）。实测整页 1888×804 与元素 3400×180 @2x 出图均正确。
- **ego_status 重做**：app 引擎没有 `--status` 子命令（exit 2），可用性改为真实一次 `-e` ping 往返判定；失败时透出错误详情。
- 能力矩阵与测量数据见 `docs/APP-COMPAT.md`。

### 平台限制
- 实验性持久 REPL 会话（`execSession: 'persistent'`）依赖真实 TTY 提供者：Node spawn 直驱 `/usr/bin/script` 会因 stdin 为 socketpair 报 `tcgetattr/ioctl: Operation not supported on socket`，故默认关闭；默认 `-e` 每次调用 ~0.5s，无需持久化。
- app 引擎的等待为轮询实现（250ms 步进）；`getByRole` 是 CSS 近似而非 ARIA 查询。

观察窗落地双画面管线：修复 CDP 协议根因，并加入可选 FFmpeg H.264/fMP4 后端。

### 新增 / 优化
- **用户自定义启动参数**：设置卡新增 `ego-browser CLI 附加参数` 与 `Chrome 启动附加参数` 两个字段。前者追加到 `ego-browser nodejs` argv，下一次 `ego_*` 工具调用即生效；后者经 `EGO_LINUX_EXTRA_ARGS` 桥接到 vendored runtime 的 `launch()`，仅浏览器下次冷启动生效（浏览器是单例常驻——需 `ego-browser --stop` 或重启 DSH 才会重新启动）。两边都拉黑会破坏插件自管控制面的标志（`--status`/`--stop`/`--help`/`--user-data-dir`/`--remote-debugging-port`/`--headless`/`--proxy-server` 等）；`--proxy-server` 请走 `EGO_LINUX_PROXY`。`ego_doctor` 报告当前生效参数。
- FFmpeg 改为显式按需安装：CDP 不再依赖或安装 `ffmpeg-static`。设置页优先检测自定义路径、系统 PATH 和托管缓存，兼容性检查完成前禁用 FFmpeg 选项，并提供固定版本、SHA-256 校验的一键下载。
- 新增 `githubMirror`，用用户填写的 HTTPS 基址替换 `https://github.com`；Windows/Linux 固定 BtbN release tag，macOS 固定平台资产。下载进入 `~/.dsh/cache/ego-browser/ffmpeg/` 临时目录，校验、解压和能力探测全部成功后才原子发布。
- 观察画面新增局部键盘输入代理：普通文本和粘贴走 `Input.insertText`，中文 IME 在 composition 完成后一次发送，控制键和快捷键走 `Input.dispatchKeyEvent`。只在点击观察画面后聚焦，不抢 DSH 自身输入。
- 新增 `ffmpegBitrateKbps` 设置（500-20000 kbps）；低/平衡/高档默认 2000/4000/8000 kbps。编码器使用目标码率、峰值码率与 VBV buffer，替代 `h264_mf` 的约 200 kbps 默认值和 `libx264 crf=28`。
- DSH 窗口进入后台时保持 watch/SSE/video 连续；lease TTL 提高到 120 秒，并对 start/switch/renew 请求做单飞去重，避免后台定时器节流造成 capture 过期和反复 `starting`。
- `CaptureManager` + watcher lease：同时只有一个活动后端和一个观看 target；面板隐藏后停止 capture。
- CDP 后端正确区分 frame ACK ID 与 flattened target session，协议错误可见；默认 20 FPS、latest-frame 限流、单 target backstop，删除透明动画强制重绘。
- FFmpeg 后端：Windows 使用 `gfxcapture(hwnd)` 直接采集 Chrome 的 D3D11 窗口 surface，其他平台保留显示来源 crop；编码为 H.264 fragmented MP4，经二进制 HTTP 与 MediaSource 播放，generation 隔离旧进程数据。
- 新设置：`captureBackend`、画质档位、CDP/FFmpeg FPS、最大宽度和编码器；旧字段集中迁移。
- 新增 MP4 parser、CDP ACK、CaptureManager、配置迁移和平台 argv 单元测试。

### 平台限制
- Windows 要求 FFmpeg 包含 `gfxcapture`；按 browser PID、target title 和 CDP window bounds 匹配 HWND，窗口被遮挡或移动时仍采集目标页面，且禁止回退到 `gdigrab desktop`。最小化行为仍由 Windows Graphics Capture 决定。
- Linux X11 使用 `x11grab`、macOS 使用 `avfoundation` display crop；遮挡和系统权限仍会影响这两个平台。
- Wayland 随包 FFmpeg 无可用 Portal/PipeWire 输入时明确报 `unsupported-ffmpeg-pipewire`，不使用 root `kmsgrab`，不静默切换整个桌面或伪装成功。

### 修复
- **偶发鼠标完全无请求 / 键盘始终不可用**：控制面不再依赖 `streamState` 或 spaces 同步，只按当前画面 target 发送；worker 继续做最终 stale-target 校验。此前前端没有任何键盘监听或协议支持，本次补齐 text/keyDown/keyUp 全链路。
- **FFmpeg 实际运行但 Tab 显示 CDP**：capture 状态统一从 SSE、watch 响应、spaces capture 和 watch/status 收敛；缺少 backend 时保留当前值，禁止默认覆盖为 CDP。
- **`space_open` 后遗留 about:blank 窗口**：成功打开的 task space 成为最近活动空间；后续省略 `space` 的 navigate/click/fill 等工具复用该空间，不再回退到固定 `dsh-agent` 创建第二个窗口。关闭活动空间后恢复配置默认值。
- **watch/start 502 与 input 500**：FFmpeg 二进制和 `gfxcapture` 能力探针改为异步子进程，启动期间 worker health 不再被阻塞；watch start/switch 的 worker 代理超时提高到 30 秒，覆盖窗口、编码器和 MP4 init 的完整上限。host 原样透传 worker HTTP 状态和 JSON 错误，仅在 worker 真不可达时返回 502。输入在客户端和 worker 双侧校验 target，失效 target 返回 409 `capture-target-stale`，不再包装成 500。
- **设置已选 FFmpeg 但 Tab 仍显示 CDP**：多 fiber 同时加载插件时，后注册的 settings bridge 遇到 namespace 重复后错误地退回空 composition config，cast worker 因而收到 `captureBackend:auto`。现在同一 settings 服务共享唯一 scope；设置卡、gateway 和 cast-server 始终读取同一持久化配置。空闲 worker 收到配置更新时也会立即发布新的 backend 状态，不再保留旧 CDP 标签。
- **Windows FFmpeg 不再录到用户前台窗口**：此前参数固定为 `gdigrab ... -i desktop`，只在启动时按页面坐标裁剪，Chrome 进入后台后会把覆盖区域中的 DSH 或其他应用串流出去。现在 target 先经 `Browser.getWindowForTarget` 和 Win32 顶层窗口枚举解析到 HWND，再用 `gfxcapture` 捕获独立窗口 surface；多任务空间的不同 Chrome 窗口分别绑定不同 HWND。同一窗口中的后台 tab 会报 `ffmpeg-target-not-visible`，不会展示错误 tab 或主动抢焦点。
- Windows 编码优先 `h264_mf` D3D11 硬件路径；编码器探针使用真实 HWND 管线，避免软件测试帧误判硬件编码不可用。显式 `fps/setpts` 固定 30 FPS，fMP4 分片降为 100ms，并用 `skip_trailer` 避免优雅停止时的 `mfra` parser 错误。
- **登录态跨 DSH 重启保持（复刻原版 ego-lite 哲学）**：此前手动重启 / 强杀 DSH 后需重新登录——worker 收到 SIGTERM/SIGINT 时只 detach 不落盘，且插件卸载的 `--stop` 宽限 4s 不够、常落到 SIGTERM crash 兜底。现在 worker 退场前先对浏览器发 CDP `Browser.close`（优雅关闭，Cookie journal 合并进磁盘 profile），插件 teardown 宽限提到 8s 足够优雅关完。**实测**：优雅重启登录完全保留；强杀（SIGKILL）长期登录态也已落盘、重启能读回。

### 安全
- **观察窗路由同源校验**：`src/cast-server.ts` 全部 `/api/ego/*` exact 路由（spaces/stream/input/close/flush/health/watch×4/video×2）统一经新增的 `sameOriginOk()` 守卫，与 `/ego/api/*` 网关既有校验对齐——浏览器请求携带的 Origin 与服务 Host 不符时直接返回 `403 {error:'origin-not-allowed'}`，恶意页面不能再借本机回环端口跨站 POST `/api/ego/input|close|flush` 操纵 agent 浏览器；无 Origin 头的 curl/探针请求不受影响。实测：伪造 Origin 403、同源与无 Origin 均 200。

### 工程重构
- **纯 JS → TypeScript 迁移**（PR #14）：源码从 `lib/` 移至 `src/`（`src/index.ts` 工具层、`src/client/index.ts` 前端、`src/worker/ego-cast-worker.ts` worker），`lib/` 与 `bin/ego-cast-worker.mjs` 改为构建产物（预构建入库）。构建链路改 `pnpm typecheck`（tsc 类型门禁，tsconfig.json + tsconfig.client.json）+ `pnpm test`（vitest）+ `pnpm run build`（tsdown 三 bundle）。测试同步迁移 `tests/*.test.mjs` → `.test.ts` 并补 `vitest.config.ts`。`lib/` 不再手改。

## [v0.9.2] - 2026-08-27

修复 `web_ai_search` / `web_search_plain` 的任务空间清理盲点：合并 PR #1（`fix/ai-search-space-cleanup`）。

### 修复
- **工具自有空间不再泄漏**：`web_ai_search` / `web_search_plain` 内部通过 `useSpace` 复用专注的 `SEARCH_SPACE='web-search'`，但从不把它 `taskSpaces.complete` 掉——摘要+引用既已返回、页面不再需要，工具退出后该空间便成为清理盲点（实测目标结束后留下一个闲置 `web-search` 空间）。新增 `resolveAutoClose`（`!keep && resolvedSpace === SEARCH_SPACE`）与 `buildAutoCloseSnippet()`：空默认空间且 `keep=false` 时，两个 builder 尾部都发射 `try{ await taskSpaces.complete(resolvedSpace,{keep:false}) }catch{}`，载荷带上 `space` + `kept`。
- **`keep` 参数语义**：两工具 schema 新增 `keep`（默认 `false`）。默认关闭自有 `web-search` 空间；调用方传入**非默认**空间时**永不**自动关闭（那是代理的目标空间）；`keep:true` 保留页面用于浏览引用。
- **空间追踪同步**：`afterExecute` 改用 `resolveAutoClose(target, bool(args.keep,false))`——自动关闭时 `cfg.spaceTracker.closed(target,true)`，否则 `selected(target)`。
- 新增 `tests/ai-search.test.ts` +10：`resolveAutoClose` / `buildAutoCloseSnippet` / 两 builder 的 `kept` 与自动关闭发射行为。

### 质量门
- `tsc` exit 0；`vitest` **88/88**（原 78 + 新增 10）；`tsdown` 重建 `lib/index.js` 119.04 kB。
- 提交 `cfbdb04`（`fix/ai-search-space-cleanup`）经 PR #1 合并进 `main`（merge `6f04f98`）；远端其余 4 个旧合并分支已清理。

## [v0.9.1] - 2026-08-27

浏览器驱动搜索：新增 `web_ai_search` / `web_search_plain`，用真浏览器换取免费 Google AI Mode 合成摘要，取代对 HTTP 型 `web_search` 的依赖。完整说明见 [`README-0.9.1.md`](./README-0.9.1.md)。

### 新增
- **`web_ai_search`**：打开 `google.com/search?q=<encode>&udm=50` 触发 Google AI Mode，**等合成完成**后抽取 **AI 摘要 + `[1][2][3]` 引用链接** 一起返回（`{ ok, answer, sources[], markdown }`）。自动处理异步渲染、consent/区域墙、瞬态重试；`queries` 数组支持多语言/多区域一次搜多条。
- **`web_search_plain`**：普通 Google 结果链接列表（标题 + URL），不做 AI 合成，适合"只取材不总结"的更省场景。
- 新增 `src/ai-search.ts`（293 行）：`buildAiSearchUrl`（CJK 正确 percent-encode、不强制 `hl/gl`，语言跟随查询内容）、`deriveSearchMarkdown`（摘要+引用一起，纯函数可测）、浏览器内脚本常量 `AI_POLL_FN`/`AI_CONSENT_FN`/`AI_EXTRACT_FN`/`PLAIN_EXTRACT_FN`、`buildAiSearchScript`/`buildPlainSearchScript`（经 `useSpace`+`ensureRealTab` 拼脚本）；常量 `SEARCH_SPACE='web-search'`、`AI_SEARCH_TIMEOUT_MS=40_000`。
- `src/index.ts` `registerActionTools` 追加 `web_ai_search`/`web_search_plain`，`web_ai_search` 结束把 `spaceTracker.selected` 指向 `args.space || SEARCH_SPACE`。
- `src/help.ts` `EGO_HELP_INDEX` 新增 `'ai-search'` 主题并追加两工具到 `tools` 列表。
- 新增 `tests/ai-search.test.ts`（156 行）：URL/CJK 编码、markdown 摘要+引用、4 个 `new Function` parseOk、build 脚本行为。

### 设计决策
- **摘要 + 引用一起返回**：不只要总结，还要 `[1][2][3]` 引用锚定来源。
- **不加 `hl`/`en`/`gl` 区域兜底**：语言跟随查询内容，跨语言用 `queries` 数组覆盖。
- **任务空间复用**：统一 `web-search` 空间，遵循"一个目标一个空间"纪律。
- **Path A：并存 + 引导**：新增轻量组件盖在大插件上，复用引擎/互斥锁/哨兵；**不删** `@deepseek-ai/dsh-tool-web`，HTTP 型 `web_search` 留作更省的廉价回退。
- **抽走机制、不搬实现**：不复刻 python-google-ai-mode-skill 的 Python/Patchright 重链路，只取 `udm=50` 触发 + 完成判定 + 提取思想。

### 修复
- **`+N` 泄漏进引用标题**：正则 `(.*?)` 中 `.` 不匹配 `\n`，真实品牌标题是多行（如 `Medium\n·Hashbyt | …\n +2`）导致 `match()` 返回 `null`、尾部 `+N` 泄漏；`src/ai-search.ts` 改 `([\s\S]*?)` 跨行匹配。此前疑虑的"双转义"为本/粘贴产物，非源码 bug。

### 质量门
- `tsc` exit 0；`vitest` **78/78**（原 76 + 新增 16 含 2 个多行标题回归）；`tsdown` 重建 `lib/index.js` 116.14 kB。
- **实机端到端验证**：首轮 `ok:true` 抽出完整 Next.js 15 答案（异步等待 11.6s，检测到 `AI 模式对话` 标题）；引用抽取 `pinned:9`（9 个唯一来源）。

## [v0.8.0] - 2026-08

sidebar Tab 集成：当 `dsh-better-sidebar` 可用时，实时查看窗注册为 sidebar 原生 Tab 而非浮动浮窗。

### 新增
- **dsh-better-sidebar Tab 集成**：`apply()` 用 `ctx.get('betterSidebar')` 机会性探测 sidebar 服务（不用 `ctx.betterSidebar`——那要求 `inject` 声明，会把 sidebar 变成硬依赖，没装时整个插件含设置卡都不加载），可用时通过 `registerTab()` 注册一个 `ego-browser:watch` Tab（`single: true`，常驻），不可用时退回原有浮动浮窗。这是 DSH 文档化的可选服务消费模式（见 approval-seam 笔记、postmortem 0001）。
- **首次 ego_* 工具调用自动打开 Tab**：`defineEgoTool` / `ego_cli` / `ego_captcha` / `ego_script` 的 execute 路径调 `markEgoToolCall()` 递增 host 端计数器，该计数器随 `/api/ego/spaces` 响应下发。`LivePreviewController` 检测计数器 0 → >0 跳变时调 `ctx.get('betterSidebar').openTab({ type: 'ego-browser:watch' })`，Tab 自动展开。`autoOpened` 标志保证每会话只开一次。
- **React Tab 组件 `EgoBrowserTab`**：用 `React.createElement` + `bindSnapshotSelector` 渲染 sidebar Tab 内容（头部 / 标签栏 / 实时主视图 / 历史覆盖层 / 登录与验证码提示条）。历史浏览轨迹从原侧抽改为覆盖式（点历史按钮接管整个 Tab 内容区，点条目进入预览或返回实时），适配 sidebar 窄宽度。
- **`LivePreviewController` vanilla 类**：从浮动浮窗的命令式 DOM 代码中提取出轮询 / SSE / 帧缓存 / 缩放 / 输入坐标逆映射 / 自动跟随逻辑，供 React 组件通过 `subscribe`+`getSnapshot` 订阅、通过方法调用转发 pointer/wheel 事件。控制器直接持有 `<img>` ref 以 rAF 合帧频率原地替换 `src`，不触发 React 逐帧重渲染。
- **`dsh-better-sidebar` 不列为 peer 依赖**：用 `ctx.get()` 机会性消费，不需要声明 `inject`，因此也不需要把它列为 peer。装了 sidebar 就用 Tab，没装就退回浮动浮窗，两种部署都干净。

### 设计取舍（诚实说明）
- **混合而非完全重写**：React 负责 UI 结构（头部 / 标签 / 提示条 / 历史覆盖层），vanilla 控制器负责实时帧管道（SSE / rAF 合帧 / 坐标逆映射 / 输入转发）。~1000 行脆弱的实时流逻辑未用 React hooks 重写，降低回归风险。
- **历史轨迹覆盖式**：原浮动浮窗的侧抽设计在 sidebar 窄宽度（~300-400px）下两列都很窄，改为覆盖式后空间利用最好。
- **竞态条件（已知，可接受）**：若 `dsh-better-sidebar` 在 ego-browser 之后加载，`apply()` 运行时 `ctx.betterSidebar` 可能仍为 `undefined`，此时退回浮动浮窗。DSH 模块加载器通常按依赖顺序加载，sidebar 作为基础 UI 插件一般先加载；若不然，刷新页面即可。
- **浮动浮窗代码原样保留**：`mountFloatingWatch()` 是原 effect body 的机械移动，未做逻辑改动，确保无 sidebar 时的体验与 0.7.x 完全一致。

## [v0.7.1] - 2026-08

修复版本：单次 `ego_space_open` 不再开两个浏览器窗口。

### 修复
- **`ego_space_open` 不再开两个浏览器窗口**：此前 launch 时把 `"about:blank"` 作为位置参数传入，会在默认 browser context 开一个残留 tab；而 `ego_space_open` 走 `useSpace+ensureRealTab`，在自己的 browser context 里再开一个 tab——Chrome 把不同 context 隔离到独立窗口，用户就看到了两窗。现在 `LAUNCH_FLAGS` 加 `--no-startup-window`、`launch()` 不再传位置 URL，启动即零 tab；第一个 tab 由 `ego_space_open`（或任何走 `useSpace+ensureRealTab` 的结构化 `ego_*` 工具）在自己的 context 中创建，这是用户唯一看到的窗口。旧注释称 `--no-startup-window` 会破坏所有 `page.*` 操作——那是引入 `useSpace+ensureRealTab` 路由之前的结论，对结构化工具不再成立。**已知回归（可接受）**：`ego_cli` / `ego_script` 中如果 heredoc 直接调 `page.*` 而不先 `taskSpaces.useOrCreate`，现在会抛 `"no active tab to attach session"`，错误信息明确，且推荐用法不受影响。

## [v0.7.0] - 2026-08

小版本更新：观察窗状态灯呼吸效果 + 前端内存治理 + 工具超时/跨平台修正。

### 新增
- **观察窗状态灯呼吸效果**：FAB 角标绿点在 agent 实际驱动浏览器（`busy`）时常绿，空闲（浏览器开着、无操作）时呼吸（2.4s 周期性绿光晕）；面板「正在实时浏览」状态点同步 busy/呼吸逻辑。原「busy=黄、idle=绿」语义翻转为「干活常绿、不干活呼吸」。

### 修复
- **`ego_script` 的 `timeoutMs` 参数此前被忽略**：schema 声明的每次运行超时覆盖从未生效，所有运行一律采用插件默认 15s 宽限。现已贯穿 `runEgoScript`，传 `timeoutMs` 真正起作用，缺省/非法时回落默认。
- **前端内存治理**：观察窗 `frameCache`（各标签最新一帧 JPEG dataURL）与 `pageMeta` 按 `targetId` 无限累积，长会话/多标签会缓慢泄漏。现在按当前存活标签表剪除已关闭标签的缓存，并给 `frameCache` 加 `MAX_CACHED_FRAMES=12` 最旧优先上限兜底。
- **硬编码 `/root` 家目录回退改为 `os.homedir()`**：状态路径探测中 POSIX 默认家目录由环境相关的 `/root` 改为跨平台正确的 `os.homedir()`，消除非 root 用户/容器环境的隐患。

### 工程
- 新增 `.gitattributes`：统一 LF 换行（`* text=auto eol=lf`），消除 Windows 侧 `core.autocrlf` 造成的工作树 CRLF 抖动与 diff/cp 误判。

## [v0.6.1] - 2026-04

修复版本：自愈链路 + 观察窗 worker 稳定性、面板引导条可用性。

### 修复
- **插件卸载不再阻塞宿主退出 / 破坏自愈**：`ctx.effect` teardown 由 `await ego-browser --stop`（15s 宽限，拖住宿主退出）改为 fire-and-forget，宿主可被 `dsh-web-guard` 在 10s 内干净拉起、被中断 turn 自动续接。
- **观察窗 worker 单实例守卫 + stale 状态清理**：同一份 `ego-cast-worker.mjs` 可能同时从安装目录与 dev 克隆被拉起、且 `ensureWorker` 在已知 pid 失效时会再拉起一个，导致 `ego-cast.json` 恒指向已死/滞后的 worker、面板失去推流。现在 worker 启动即枚举并停止其他同名进程（Windows 经 `powershell -EncodedCommand`，POSIX 走 `ps`），并删除 stale 的 `ego-cast.json`，让本进程 `{port,pid}` 成为唯一权威。
- **登录 / 人机验证引导条支持手动关闭**：新增 × 按钮；两条引导条互斥显示（人机验证优先），不再"关不掉"或"双条叠加压缩画面"。
- **观察窗主动跟随 agent 正在操作的页面**：此前面板用"最后一次重绘"(lastActive) 当作当前页，后台动画/视频页重绘会抢占视图，agent 切页时主画面不跳转。现 worker 经 DevTools `/json/list` 取浏览器 MRU 激活 tab（与 ego runtime `tabs.mjs` 同源判定），在 `/api/spaces` 与 SSE 中都标记 `active: true` 并排第一；前端 auto-follow 仅跟随激活页、忽略后台重绘帧。

## [v0.6.0] - 2026-04

代码健康治理（工程收敛）。

- 消除构建覆盖炸弹：删除过时的 `src/`（561 行旧版）与 `tsconfig.json`，确立 **`lib/` 为唯一权威源**。`npm run build` 由「tsc 编译 src→lib（会导致旧版覆盖、工具全丢）」改为「对 `lib/` 做语法校验（`node --check`）」。
- 统一工具注册：`ego_captcha` / `ego_help` / `ego_doctor` / `ego_script` 改为与其他工具一致的 `withEgoLock` + 冷启动重试路径（并发安全）。
- 不再分叉：新增能力（下载捕获、人机验证检测、30+ 工具）以 `lib/` 为准。

## [v0.5.0] - 2026-04

实时推流 + 监控窗直接操作浏览器。

- 修复实时推流关键 bug：`screencastFrame` 匹配错误字段，实时帧从未真正经 SSE 推送。已修正，动态页面接近 10~30fps 推帧。
- cast-server 流式转发改用 `node:http`（fetch 对 chunked 响应缓冲导致首帧延迟）。
- 监控窗鼠标直接操作 agent 浏览器：滚轮滚动、点按/拖动点击真实浏览器（`/api/ego/input` → CDP `Input.dispatchMouseEvent`），Ctrl+滚轮缩放、Ctrl+拖动平移、双击复位，坐标按真实视口逆映射含 letterbox 校正。
- 新增 `/api/ego/stream`（SSE）实时帧 + 页面列表。
- 登录引导条 +「已登录，保存」（触发 `/api/ego/flush` 落盘）；修复 `ego_auth_flush` Windows 状态目录路径。

## [v0.4.0] - 2026-04

跨平台（Windows 适配落地）。

- Windows 原生支持：`IS_WIN` + `windowsChromeCandidates()` 自动探测 Chrome/Edge/Brave 安装目录与 `PATH`/`%PATHEXT%`。
- 注入服务改为 `webServer`/`httpServer` 二选一，Windows 也能挂载观察窗。
- 状态路径跨平台：Windows 用 `%LOCALAPPDATA%\ego-lite-linux`，POSIX 用 `$XDG_STATE_HOME/ego-lite-linux`。

## [v0.3.0] - 2026-04

修复与增强。

- 冷启动自动重试：每个 `ego_*` 动作新起 `ego-browser` 子进程，会话预热期偶发 `CDP channel is not open` / DevTools 超时。内置最多 3 次逐步退避重试，仅对瞬时冷启动错误重试，真错误立即透传。

## [v0.2.0] - 2026-04

亮点：实时观察前端口。

- `lib/client.js`：深色毛玻璃 UI，右下角 🌐 小球常驻，点开见 agent 实时画面。
- 标签管理：横排标签条 + 每标签 `×` 关闭（真正关浏览器标签）。
- 缩放/拖拽/复位、动态轮询（活跃 2s / 静止 8s）、导航复用 tab。
- `bin/ego-cast-worker.mjs`：attach 到 agent 正在用的浏览器，CDP 实时推帧，崩溃自动重启。
- 开箱即用：`bin/ego-chrome-wrapper.sh` 随包自带，root/无头自动 `--no-sandbox`。
