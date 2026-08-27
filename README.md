# ego-browser — 让 Agent 驱动你本机的官方 ego lite

> 本仓库是 [`Fisfzy/dsh-ego-browser`](https://github.com/Fisfzy/dsh-ego-browser) 的社区二改分支（当前维护：[moyu12-ae/dsh-ego-browser](https://github.com/moyu12-ae/dsh-ego-browser)）。版本历史见 [CHANGELOG.md](CHANGELOG.md)。

把 [CitroLabs/ego-lite](https://github.com/CitroLabs/ego-lite) 接入 DeepSeek Harness：以 **32 个结构化 `ego_*` 工具**驱动浏览器，让 agent 在**独立的任务空间**里复用你的登录态干活，不与你的日常浏览互相打扰。

## v0.9.0 方向变化（先读这个）

本分支与上游的核心分歧：

| | 上游 v0.8.x | 本分支 v0.9.0+ |
|---|---|---|
| 浏览器来源 | 自带 vendored 运行时（随包 Chromium 管理启动） | **优先驱动本机已安装的官方 ego lite App**，vendored 仅作兜底 |
| 实时观察窗 | 自带 SSE/FFmpeg 推流前端 + 监控窗接管 | **移除**——"看得见"由官方 ego lite App 窗口本身承担（它本来就是给人看的） |
| 安装体积 | 含完整 runtime | 运行时仍保留作 Linux/Docker 兜底，但首选路径零额外进程 |

配套地，任务空间生命周期纪律对齐官方 skill：**一个目标一个空间、用完必关（`keep` 默认 `false`）**，不再留下"做完任务的残留页面"。

## 它解决什么问题

通用浏览器不是为 agent 设计的，而 Web 上大量交互（登录态、验证码、动态渲染、表单、需真人会话的站点）只有真浏览器能面对。ego lite 让 agent 用你已登录的浏览器而不打扰你；本插件把它接进 DSH：

- 每个用户目标一个**任务空间**（隔离 browsing context，继承登录态），后续追问自动复用；
- agent 全程结构化调用——导航、语义快照、点击填表、等待网络、截图取证——而不是猜选择器；
- 结果以 JSON 哨兵回传，错误统一归一，冷启动瞬态自动重试。

### 引擎选择（`engineMode`）

| 值 | 行为 |
|---|---|
| `auto`（默认） | 探测到官方 ego lite App（`~/.local/bin/ego-browser` 或 App bundle 内 Helpers）→ 用之；否则回退 vendored |
| `app` | 强制官方 App |
| `vendored` | 强制自带运行时（Linux 服务器 / Docker / 无 App 场景） |

官方 App 与 vendored 的能力差异矩阵见 [docs/APP-COMPAT.md](docs/APP-COMPAT.md)：app flavor 缺失的 facade（如 locator 细分方法、元素截图）由 `src/app-facades.ts` 兼容预置层补齐。

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

## 任务空间生命周期（重要纪律）

- 一个用户目标 = 一个任务空间；同一目标的追问/纠错/验收**必须复用**原空间。
- 目标完成后必须 `ego_space_close` 收尾，**默认 `keep=false` 直接关闭页面**。
- 只有三种情况允许 `keep=true`：① 用户明确要求保留现场；② 需要用户在该页面上手动操作（登录/验证码）；③ 结果无法用文件/工件/摘要交付。「访问过页面」「截图验证过」不是理由。
- 需要保留时，先关掉 scratch 标签页，只留值得给用户看的页。

## 配置项

| 键 | 说明 |
|---|---|
| `engineMode` | `auto` / `app` / `vendored`，见上表 |
| `execSession` | app 引擎执行通道：默认每次 `-e` 求值（~0.4s 往返）；`persistent` opt-in 实验性 REPL |
| `egoCliArgs` | 追加到 `ego-browser nodejs` 的自定义参数（危险参数白名单过滤） |
| `chromePath` / `chromeArgs` | vendored 引擎的 Chrome 路径与附加启动参数 |

## 工作原理

- **工具层**：每个工具把参数拼成 JS 脚本；app 引擎经 `[node, egoBin, 'nodejs', '-e', script]` 直执行（vendored 经 stdin heredoc），结果以哨兵行回传解析。所有 `ego_*` 经进程内互斥锁串行化；仅重试已知冷启动瞬态签名，不吞真错。
- **兼容预置层**：app flavor 下脚本前置 `APP_FACADE_PRELUDE`，重建 `page/browser/taskSpaces/site` 命名空间与完整 locator 表面（守卫式安装——官方未来原生绑定时不冲突）。
- **卸载**：vendored 引擎 fire-and-forget `--stop` 清场；app 引擎不动用户的浏览器（那是用户自己的 App）。

## 开发

源码在 `src/`（TypeScript），构建产物在 `lib/index.js`。

```sh
npm run typecheck   # tsc 类型门禁
npm test            # vitest 单元测试
npm run build       # tsdown 单产物 lib/index.js
```

> 直接改 `src/`，构建后提交产物（部署从仓库克隆装载）。新工具在 `registerActionTools` 里按 `t({...})` 加，并在 `ego_help` 索引（`src/help.ts`）补一条。架构与防冲突规范见 [docs/ARCH.md](docs/ARCH.md)。

## 已知限制（诚实说明）

- **快照/等待语义**：app flavor 下部分等待是兼容层的轮询实现（250ms 步进），非原生事件等待；细节见 [docs/APP-COMPAT.md](docs/APP-COMPAT.md)。
- **Windows**：官方 App 有 Windows 版；vendored 底层宿主仍是社区移植，复杂多步流程稳定性可能弱于 macOS。
- **安装环境**：DSH peer 包不全在公共 npm registry，普通 `pnpm install` 可能在解析 peer 时失败；DSH profile 安装应提供这些 peer。
- 输出 schema 为宽松 `additionalProperties: true`，客户端以实际返回值为准。

## 许可与署名

插件本体 MIT。vendored 运行时嵌入 ego-lite 的 MIT 代码（本地改动见 [runtime/PATCHES.md](runtime/PATCHES.md)）。使用或再分发前请阅读 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
