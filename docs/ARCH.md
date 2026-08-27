# dsh-ego-lite 架构与维护指南

> 本文档是**代码健康**的核心：让任何维护者在改代码前先看懂结构，
> 知道"改哪里、怎么改、别踩什么坑"，从而避免深度冲突和"改不动"。

## 0. 一句话

这是一个 DSH 插件：**驱动本机官方 ego lite App（vendored 运行时兜底）**，
把浏览器自动化能力封装成 30+ 个 `ego_*` 结构化工具。
（v0.9.0 起移除了自带的实时观察窗/推流栈——"看得见"由官方 ego lite App 窗口本身承担。）

---

## 1. 顶层结构

```
ego-browser/
  package.json          # 版本号、build=tsdown 单产物 lib/index.js
  src/                  # [权威源] TypeScript，唯一编辑面
  src/index.ts          # [后端] 插件入口 + 30+ ego_* 工具注册
  src/engine.ts         # [后端] 运行时解析：官方 App 优先 / vendored 兜底 + argv/env 适配
  src/app-facades.ts    # [后端] 官方 App flavor 的 page/browser/taskSpaces 兼容预置层
  src/repl-session.ts   # [后端] 官方二进制持久 REPL 会话通道（.cell 协议 + 哨兵）
  src/config.ts         # 设置 schema、resolveConfig 与 CLI 参数过滤
  src/settings.ts       # settings namespace 注册（Symbol.for 共享 scope）
  src/captcha.ts        # 人机验证探针脚本
  src/help.ts           # ego_help 索引文案
  src/types.ts          # 结构化宿主类型（不依赖 cordis 编译期安装）
  lib/index.js          # [构建产物] 由 `npm run build` 从 src/ 打包（勿手改）
  bin/ego-chrome-wrapper.sh  # vendored runtime 的 --no-sandbox wrapper（非产物）
  runtime/              # vendored ego-lite 运行时（兜底引擎；本地改动见 runtime/PATCHES.md）
  docs/ARCH.md          # 本文件
  docs/APP-COMPAT.md    # 官方 App flavor 与 vendored 的差异矩阵
```

**关键约定**：`src/` 是唯一权威源；`lib/index.js` 是 tsdown 构建产物，
改代码只改 `src/`，然后 `npm run build` 再提交产物（产物入库是因为部署
直接从仓库克隆装载）。历史注：v0.6.0 曾删除 src 只留手写 lib，v0.9.0
TS 迁移已恢复 src 为源。

---

## 2. lib/index.js — 工具层（最大、最重要）

它内部已按职责清晰分区（虽然在一个文件里）：

| 职责 | 说明 |
|---|---|
| 顶部常量 | SENTINEL、探针、默认值 |
| `withEgoLock` | 全插件工具互斥锁：所有 ego_* 串行，防争用同一浏览器 |
| `runEgoScript` / `parseSentinel` / `withWarmupRetry` | 脚本执行引擎：每工具一次 spawn；app 引擎走 `nodejs -e`，vendored 走 stdin heredoc |
| `defineEgoTool` / `t()` | 工具封装基座：统一加锁 + 冷启动重试 + 输出 schema |
| `registerActionTools` | **大部分 ego_* 工具**（含空间生命周期纪律的描述文案） |
| `registerEgoStatus` / `registerAuthFlush` / `registerHelpAndDoctor` | status / auth_flush / help·doctor·script·captcha |

### 怎么加一个工具（新功能入口）
1. 在 `registerActionTools` 里 `reg(t({ name:'ego_xxx', description, parameters:{...}, buildScript:(args)=>\`…\` }))`
2. `buildScript` 返回一段会在 ego-browser 里执行的 JS（app flavor 会先注入 `APP_FACADE_PRELUDE`）
3. 结束后用哨兵行回传结构化结果（`console.log('@@DSH_RESULT@@'+JSON.stringify(payload))`）
4. 在 `EGO_HELP_INDEX` 补一条；改完跑 `npm run typecheck && npm test && npm run build`

### 注意
- 所有操作浏览器的工具**必须**走 `withEgoLock`（`t()` 会自动包）——不要绕过它
- 官方二进制把内嵌 `console.log` 全送 stderr——哨兵解析要 stdout/stderr 双路兜底（已实现，勿删）
- app 引擎下 facade 缺失是常态而非 bug：新依赖先查 `docs/APP-COMPAT.md` 与 `src/app-facades.ts`
- 任务空间生命周期纪律写死在 `ego_space_open/close` 描述与 `help.index.space` 中
  （keep 默认 false，仅三种正当理由可保留）——改文案时保持与官方 SKILL.md 一致

---

## 3. runtime/ — vendored 兜底运行时

`runtime/` 来自 ego-lite（MIT），我们只做了少量本地改动：
- `cursor.mjs`：默认水印 Claude → DeepSeek（品牌）
- `task-spaces.mjs` / `transport.mjs` 等：针对性 bug 修复
- `chrome.mjs`：macOS Chrome 探测路径 + 代理支持

**跟进上游 / 排查时**：每次改 runtime 请在 `runtime/PATCHES.md` 记录「改了什么 + 为什么」，
避免与上游合并时冲突到无从回溯。

---

## 4. 防冲突规范（最重要）
1. **src/ 是唯一权威源**：改代码只改 `src/`，`npm run build` 再提交 `lib/`。
2. **加工具走 t() + withEgoLock**，补 help 索引。
3. **双镜像警惕**：`tokenizeArgs/filterArgs/CHROME_BLOCKED` 在 `lib/config.js` 与
   `runtime chrome.mjs` 各持一份——改动一处要评估另一处。
4. **发版本**：改 `package.json` 版本 → 更新 CHANGELOG → `git tag vX.Y.Z` → push。
