import { defineTool } from "@deepseek-ai/dsh-tools";
import { existsSync, readdirSync } from "node:fs";
import { homedir, platform } from "node:os";
import { fileURLToPath } from "node:url";
import z from "schemastery";
import { settingsNamespace } from "@deepseek-ai/dsh-settings";
import { join } from "node:path";
import { spawn } from "node:child_process";

//#region src/help.ts
/**
* src/help.ts — tool index copy (EGO_HELP_INDEX).
*
* Pure data module: the `topic` lookup table for the ego_help tool. When you
* add/change a tool, remember to sync an entry here or ego_help won't find it.
*/
const EGO_HELP_INDEX = {
	overview: "ego-browser 结构化浏览器工具。导航/交互/观察/表单/网络/等待/键鼠皆有专项工具，另提供 ego_help(本索引)、ego_doctor(体检)、ego_cli/ego_script(自由脚本逃生舱)。分类见: tools / space / navigate / observe / input / keyboard-mouse / form / wait / network / login / script / doctor。用 `topic` 查询，或直接给工具名。",
	tools: "工具清单: ego_status, ego_space_open, ego_space_close, ego_snapshot, ego_navigate, ego_click(+double), ego_fill, ego_js, ego_cdp, ego_screenshot(+selector), ego_page_info, ego_wait, ego_wait_for_selector, ego_wait_for_url, ego_wait_for_response, ego_key(+text/type), ego_hover, ego_read_element, ego_select, ego_drag, ego_scroll, ego_upload, ego_check, ego_dialog, ego_download, ego_http, ego_captcha, ego_auth_flush, ego_help, ego_doctor, ego_cli, ego_script。",
	space: "生命周期纪律: 一个用户目标一个任务空间，后续追问复用同一空间；目标完成后必须 ego_space_close 收尾——默认 keep=false 直接关闭页面。仅三种情况才 keep=true: ①用户明确要求保留现场 ②需要用户在该页面上手动操作(登录/验证码等) ③结果无法用文件/工件/摘要交付。「访问过页面」「截图验证过」不构成保留理由。keep=true 时先关掉 scratch 标签页只留值得展示的页。",
	navigate: "ego_navigate: 打开URL或切tab(同任务复用当前tab)。ego_wait_for_url: 等跳转(登录/分页)。",
	observe: "ego_snapshot: 整页语义树(带[ref]/loc供点击); ego_page_info: url/标题/视口/滚动/对话框/人机验证; ego_read_element: 读单元素文本/HTML/值/属性/可见性/计数; ego_screenshot(+selector): 整页或元素截图。",
	input: "ego_click(selector/坐标, double双击); ego_fill(填框); ego_key(press组合键 或 text连续键入); ego_check(勾选/取消); ego_select(下拉); ego_upload(文件上传); ego_dialog(接受/取消JS对话框)。",
	"keyboard-mouse": "ego_key: 键盘(press/text); ego_hover: 悬停; ego_drag: 拖拽(元素或坐标); ego_scroll: 滚轮/滚到元素; ego_click: 点击/双击。",
	form: "ego_fill 填输入框; ego_select 下拉; ego_check checkbox/radio; ego_upload 文件; ego_key 回车/Tab导航; ego_dialog 处理提交弹窗。",
	wait: "ego_wait(固定毫秒); ego_wait_for_selector(等元素出现/消失); ego_wait_for_url(等跳转); ego_wait_for_response(等网络响应并可读body)。",
	network: "ego_http: 发HTTP请求(默认浏览器上下文 fetch.browser, mode=server走Node fetch.server); ego_wait_for_response: 等并读接口响应。",
	download: "ego_download: 等下载事件并落到指定路径(triggerSelector/triggerScript + 可选 savePath)。",
	captcha: "ego_captcha: 检测页面人机验证(CAPTCHA)并返回{detected,kind}; 检测到请让用户去 ego 浏览器完成; ego_page_info 也附带 humanCheck。",
	login: "ego_auth_flush: 把持久登录 cookie 落盘到 ego profile（官方 App 与 vendored runtime 各自的 state 目录）。多任务空间 Cookie 相互隔离，请在对应空间内登录后 flush。",
	script: "ego_cli / ego_script: 原样运行任意 ego-browser nodejs heredoc脚本(page/browser/taskSpaces/site/fetch/cdp预载)。ego_script额外返回 duration/timedOut。",
	doctor: "ego_doctor: 体检环境(engine 引擎、浏览器候选、vendored runtime、状态目录、CDP端口、任务空间)。"
};

//#endregion
//#region src/captcha.ts
/**
* src/captcha.ts — human-verification (CAPTCHA) detection probe.
*
* Standalone data module: HUMAN_CHECK_PROBE is a string that gets serialized
* into a `page.evaluate` call to identify reCAPTCHA / hCaptcha / Turnstile /
* Cloudflare / generic captcha. When changing probe heuristics, note that
* bin/ego-cast-worker.mjs (now src/worker/ego-cast-worker.ts) has a similar
* probe (HUMAN_PROBE_JS) — the two must stay in sync.
*/
const HUMAN_CHECK_PROBE = `(() => {
  const sel = [
    'iframe[src*="recaptcha"]', '.g-recaptcha', '[data-sitekey]',
    '.h-captcha', 'iframe[src*="hcaptcha"]',
    '.cf-turnstile', 'iframe[src*="turnstile"]',
    'iframe[src*="cloudflare"]', '#challenge-form', '.challenge-form',
    '#captcha', '.captcha'
  ].join(',');
  const el = document.querySelector(sel);
  if (el) {
    const html = (el.outerHTML || '') + (el.closest('body') && el.closest('body').innerHTML ? '' : '');
    const s = String(html);
    if (/recaptcha|g-recaptcha/i.test(s)) return { detected: true, kind: 'recaptcha' };
    if (/hcaptcha|h-captcha/i.test(s)) return { detected: true, kind: 'hcaptcha' };
    if (/turnstile|cf-turnstile/i.test(s)) return { detected: true, kind: 'turnstile' };
    if (/cloudflare|challenge-form/i.test(s)) return { detected: true, kind: 'cloudflare' };
    return { detected: true, kind: 'captcha' };
  }
  const txt = (document.body ? document.body.innerText || '' : '').slice(0, 120000);
  const lower = txt.toLowerCase();
  if (/verify you are human|your activity looks unusual|captcha|i.?m not a robot|人机验证|安全验证|我是人类|验证码|滑块验证|拖动滑块|点击.*验证/.test(lower)) {
    return { detected: true, kind: 'captcha' };
  }
  return { detected: false, kind: null };
})()`;

//#endregion
//#region src/config.ts
const Config$1 = z.object({
	chromePath: z.string().description("Path to Chrome/Chromium. Empty = auto-detect. (vendored runtime only)"),
	egoCliArgs: z.string().description("Extra args appended to `ego-browser nodejs` argv. Takes effect on the next ego_* call."),
	chromeArgs: z.string().description("Extra args appended to the Chrome launch argv (vendored runtime only). Takes effect on the next browser cold start (the browser is a singleton)."),
	engineMode: z.union([
		"auto",
		"app",
		"vendored"
	]).description("CLI flavor: auto prefers the official ego lite app and falls back to the vendored runtime."),
	execSession: z.union([
		"auto",
		"persistent",
		"per-call"
	]).description("Execution channel for the official ego lite binary: auto/per-call spawn one `nodejs -e` eval per call (~0.4s full roundtrip, default); persistent OPTS INTO an experimental attached REPL session (requires a real TTY provider and is disabled by default).").default("auto")
});
/**
* Flags the user must NOT put in `egoCliArgs`: these ego-browser subcommands
* exit before the heredoc runs (--status/--stop/--help/...) or steal the
* browser window (--open), so appending them would break every ego_* tool.
* `--headless` is managed by EGO_LINUX_HEADLESS; `--sdk-path` is allowed.
*/
const EGO_CLI_BLOCKED = new Set([
	"--status",
	"--stop",
	"--open",
	"--spaces",
	"--spaces-daemon",
	"--prune-spaces",
	"--import-chrome-profile",
	"--install-desktop-entry",
	"--help",
	"-h"
]);
/**
* Flags the user must NOT put in `chromeArgs`: these are managed by the
* launcher / EGO_LINUX_PROXY and overriding them would break CDP control,
* profile isolation, or the proxy bypass list. `--proxy-server` should go
* through EGO_LINUX_PROXY (which also sets the bypass list).
*/
const CHROME_BLOCKED = new Set([
	"--user-data-dir",
	"--remote-debugging-port",
	"--remote-allow-origins",
	"--headless",
	"--no-startup-window",
	"--proxy-server",
	"--proxy-bypass-list"
]);
/**
* Shell-like tokenizer for user-supplied arg strings. Handles single/double
* quotes and backslash escapes; bare whitespace separates tokens. Returns []
* for empty/whitespace-only input. Used for both `egoCliArgs` and `chromeArgs`
* (mirrored in runtime/ego-linux/src/chrome.mjs for the Chrome side, since the
* runtime must not import from src/).
*/
function tokenizeArgs(input) {
	if (typeof input !== "string") return [];
	const out = [];
	let cur = "";
	let i = 0;
	let quote = null;
	while (i < input.length) {
		const c = input[i];
		if (quote) {
			if (c === "\\") {
				const next = input[i + 1];
				if (next !== void 0) {
					cur += next;
					i += 2;
					continue;
				}
			} else if (c === quote) {
				quote = null;
				i += 1;
				continue;
			}
			cur += c;
			i += 1;
			continue;
		}
		if (c === "\"" || c === "'") {
			quote = c;
			i += 1;
			continue;
		}
		if (c === "\\") {
			const next = input[i + 1];
			if (next !== void 0) {
				cur += next;
				i += 2;
				continue;
			}
			i += 1;
			continue;
		}
		if (c === " " || c === "	" || c === "\n" || c === "\r") {
			if (cur !== "") {
				out.push(cur);
				cur = "";
			}
			i += 1;
			continue;
		}
		cur += c;
		i += 1;
	}
	if (cur !== "") out.push(cur);
	return out;
}
/**
* Split a raw arg string into tokens, dropping any token (and, for `--flag
* value` pairs, its value) that appears in `blocked`. A "blocked" token with a
* `=` attached (e.g. `--headless=new`) is also dropped. Returns the surviving
* tokens. Exposed for tests and for the runtime to mirror.
*/
function filterArgs(raw, blocked) {
	const tokens = tokenizeArgs(raw);
	const kept = [];
	for (let i = 0; i < tokens.length; i++) {
		const tok = tokens[i];
		const key = tok.includes("=") ? tok.slice(0, tok.indexOf("=")) : tok;
		if (blocked.has(key)) {
			if (!tok.includes("=") && i + 1 < tokens.length && !tokens[i + 1].startsWith("-")) i += 1;
			continue;
		}
		kept.push(tok);
	}
	return kept;
}
function oneOf(value, values, fallback) {
	return typeof value === "string" && values.includes(value) ? value : fallback;
}
function resolveConfig(config = {}) {
	return {
		chromePath: typeof config.chromePath === "string" ? config.chromePath : "",
		egoCliArgs: typeof config.egoCliArgs === "string" ? config.egoCliArgs : "",
		chromeArgs: typeof config.chromeArgs === "string" ? config.chromeArgs : "",
		engineMode: oneOf(config.engineMode, [
			"auto",
			"app",
			"vendored"
		], "auto"),
		execSession: oneOf(config.execSession, [
			"auto",
			"persistent",
			"per-call"
		], "auto")
	};
}

//#endregion
//#region src/settings.ts
/** Settings namespace under which ego-browser config persists. */
const SETTINGS_NAMESPACE = settingsNamespace("ego-browser");
const SHARED_SCOPE_KEY = Symbol.for("@dsh-external/ego-browser.settings-scope");
function getSharedScope() {
	const existing = globalThis[SHARED_SCOPE_KEY];
	if (existing) return existing;
	const fresh = {
		scope: null,
		refs: 0
	};
	globalThis[SHARED_SCOPE_KEY] = fresh;
	return fresh;
}
/**
* Mirror of the dsh-settings internal `isUnloading` guard. The cordis const
* enum for fiber state is erased at compile time, so the literal states are
* matched numerically: 4 = DISPOSED, 5 = UNLOADING.
*/
function isUnloading(ctx) {
	const state = ctx.fiber?.state;
	return state === 4 || state === 5;
}
/**
* Install the `ego-browser` settings namespace and return the bridge.
*
* The settings service is reached through `ctx.inject(['settings'], ...)` so a
* composition without a settings provider still loads the plugin (entry-source
* fallback, no persistence). Multi-fiber dedupe is handled by catching the
* `"already registered"` rejection — host composition may mount several
* concurrent fibers of this plugin, and only the first registration owns the
* namespace.
*/
function installEgoBrowserSettings(ctx, entry) {
	const listeners = /* @__PURE__ */ new Set();
	let source = () => entry;
	const notify = () => {
		for (const listener of [...listeners]) listener();
	};
	ctx.inject?.(["settings"], (sctx) => {
		const sharedScope = getSharedScope();
		let scope = sharedScope.scope;
		if (!scope) try {
			scope = sctx.settings.register(SETTINGS_NAMESPACE, Config$1, { base: entry });
			sharedScope.scope = scope;
		} catch (error) {
			if (!(error instanceof Error) || !error.message.includes("already registered")) throw error;
			ctx.logger?.("ego-browser")?.warn("settings namespace already registered outside the shared bridge");
			return;
		}
		sharedScope.refs += 1;
		source = () => scope.get();
		const offScopeWatch = scope.watch(() => {
			if (isUnloading(ctx)) return;
			notify();
		});
		sctx.effect?.(() => () => {
			offScopeWatch?.();
			sharedScope.refs = Math.max(0, sharedScope.refs - 1);
			if (sharedScope.refs === 0 && sharedScope.scope === scope) sharedScope.scope = null;
			if (isUnloading(ctx)) return;
			source = () => entry;
			notify();
		});
		notify();
	});
	return {
		source: () => source(),
		onChange: (cb) => {
			listeners.add(cb);
			return () => {
				listeners.delete(cb);
			};
		}
	};
}

//#endregion
//#region src/engine.ts
/** Vendored CLI shipped inside this plugin (runtime/ego-linux/bin/). */
const VENDORED_EGO_BIN = fileURLToPath(new URL("../runtime/ego-linux/bin/ego-browser.mjs", import.meta.url));
const APP_BUNDLE = "ego lite.app";
/** macOS app-search roots; resolved lazily so tests can inject a fake home. */
function appDirs(home) {
	return ["/Applications", join(home, "Applications")];
}
function looksLikeJsModule(binPath) {
	return /\.mjs$|\.cjs$|\.js$/i.test(binPath);
}
function findFrameworkHelper(bundleDir, io) {
	const frameworksDir = join(bundleDir, "Contents", "Frameworks");
	let frameworks;
	try {
		frameworks = io.list(frameworksDir);
	} catch {
		return null;
	}
	for (const fw of frameworks) {
		const candidate = join(frameworksDir, fw, "Versions", "Current", "Helpers", "ego-browser");
		if (io.exists(candidate)) return candidate;
	}
	let best = null;
	for (const fw of frameworks) {
		const versionsDir = join(frameworksDir, fw, "Versions");
		let versions;
		try {
			versions = io.list(versionsDir);
		} catch {
			continue;
		}
		for (const version of versions) {
			if (!/^\d+(\.\d+)*$/.test(version)) continue;
			const candidate = join(versionsDir, version, "Helpers", "ego-browser");
			if (!io.exists(candidate)) continue;
			const rank = version.split(".").map((n) => Number.parseInt(n, 10) || 0);
			if (best === null || ranksGreater(rank, best.version.split(".").map((n) => Number.parseInt(n, 10) || 0))) best = {
				version,
				path: candidate
			};
		}
	}
	return best?.path ?? null;
}
function ranksGreater(a, b) {
	const len = Math.max(a.length, b.length);
	for (let i = 0; i < len; i++) {
		const av = a[i] ?? 0;
		const bv = b[i] ?? 0;
		if (av !== bv) return av > bv;
	}
	return false;
}
const nodeFsIo = {
	exists: (path) => existsSync(path),
	list: (path) => readdirSync(path)
};
function resolveEngine(opts = {}) {
	const home = opts.home ?? homedir();
	const plat = opts.platform ?? platform();
	const io = opts.io ?? nodeFsIo;
	const mode = opts.engineMode === "app" || opts.engineMode === "vendored" ? opts.engineMode : "auto";
	const configured = typeof opts.configuredEgoBin === "string" && opts.configuredEgoBin.trim() !== "" ? opts.configuredEgoBin.trim() : "";
	if (configured !== "" && io.exists(configured)) {
		const jsRuntime = looksLikeJsModule(configured);
		return {
			flavor: configured.includes("ego-linux") || jsRuntime ? "vendored" : "app",
			binPath: configured,
			jsRuntime,
			origin: "configured"
		};
	}
	if (mode !== "vendored") {
		const candidates = [];
		if (plat === "darwin") {
			candidates.push({
				path: join(home, ".local", "bin", "ego-browser"),
				origin: "~/.local/bin (app symlink)"
			});
			for (const base of appDirs(home)) candidates.push({
				path: findFrameworkHelper(join(base, APP_BUNDLE), io) ?? "",
				origin: `${base}/${APP_BUNDLE}`
			});
		}
		for (const candidate of candidates) if (candidate.path !== "" && io.exists(candidate.path)) return {
			flavor: "app",
			binPath: candidate.path,
			jsRuntime: false,
			origin: candidate.origin
		};
	}
	return {
		flavor: "vendored",
		binPath: VENDORED_EGO_BIN,
		jsRuntime: true,
		origin: "vendored runtime/ego-linux"
	};
}
/** Full spawn argv for one heredoc-style invocation. */
function buildSpawnArgv(engine, extraCliArgs, nodeExecPath) {
	return [
		...engine.jsRuntime ? [nodeExecPath] : [],
		engine.binPath,
		"nodejs",
		...extraCliArgs
	];
}
const EGO_LINUX_ENV_KEYS = [
	"EGO_LINUX_CHROME",
	"EGO_LINUX_HEADLESS",
	"EGO_LINUX_EXTRA_ARGS",
	"EGO_LINUX_PROXY"
];
/**
* Env for one invocation. The vendored flavor gets the full auto-adapted env
* (chrome discovery/headless/proxy bridging); the app flavor deliberately gets
* NONE of those keys — the user's running app owns its browser, and leaking
* Linux-shim hints at the official binary could only confuse it.
*/
function engineEnv(engine, vendoredEnv) {
	if (engine.flavor === "vendored") return vendoredEnv;
	const env = { ...vendoredEnv };
	for (const key of EGO_LINUX_ENV_KEYS) delete env[key];
	return env;
}

//#endregion
//#region src/repl-session.ts
const SENTINEL$1 = "@@DSH_RESULT@@";
/** Error marker string; index.ts folds it into COLD_START_SIGNS. */
const REPL_DIED_ERROR = "ego-browser REPL session terminated unexpectedly";
const PROMPT = "repl> ";
/** The binary is booted through a pty wrapper; BSD `script` ships with macOS. */
const SCRIPT_BIN = "/usr/bin/script";
function splitSentinelLiteral(script) {
	const pattern = new RegExp(`['\"]${SENTINEL$1.replace(/@/g, "\\@")}['\"]`, "g");
	return script.replace(pattern, `'@@DSH_RE'+'SULT@@'`);
}
function wrapCell(script) {
	return `try {\n${splitSentinelLiteral(script)}\n}catch (__egoCellErr) { console.log('@@DSH_RE'+'SULT@@' + JSON.stringify({ ok: false, error: String(__egoCellErr && __egoCellErr.message || __egoCellErr) })) }`;
}
function extractLastSentinel(text) {
	let parsed;
	const lines = text.split(/\r?\n/);
	for (let i = lines.length - 1; i >= 0; i--) {
		const idx = lines[i].indexOf(SENTINEL$1);
		if (idx === -1) continue;
		try {
			parsed = JSON.parse(lines[i].slice(idx + 14));
			break;
		} catch {
			continue;
		}
	}
	return parsed;
}
function replSupported(flavor) {
	return platform() === "darwin" && flavor === "app" && existsSync(SCRIPT_BIN);
}
var ReplSession = class {
	child = null;
	ready = false;
	dead = false;
	pending = null;
	promptCount = 0;
	launchTail = "";
	bootWaiters = [];
	stdoutCap;
	constructor(binPath, bootTimeoutMs, maxOutputBytes = 4 * 1024 * 1024) {
		this.binPath = binPath;
		this.bootTimeoutMs = bootTimeoutMs;
		this.stdoutCap = maxOutputBytes + 64 * 1024;
	}
	get alive() {
		return this.child !== null && !this.dead;
	}
	/** Spawn + wait for the REPL banner/prompt. Resolves even when the app was
	*  never contacted yet — booting the embedded runtime is what we wait for. */
	async launch() {
		if (this.child !== null) return;
		const child = spawn(SCRIPT_BIN, [
			"-q",
			"/dev/null",
			this.binPath,
			"nodejs"
		], {
			stdio: [
				"pipe",
				"pipe",
				"pipe"
			],
			env: {
				...process.env,
				TERM: "dumb"
			}
		});
		this.child = child;
		child.stdout?.setEncoding("utf8");
		child.stdout?.on("data", (chunk) => {
			this.onChunk(chunk);
		});
		child.stderr?.on("data", () => {});
		const failBoot = () => {
			this.dead = true;
			this.flushBootWaiters();
			this.failPending(REPL_DIED_ERROR);
		};
		child.on("exit", failBoot);
		child.on("error", failBoot);
		const deadline = Date.now() + this.bootTimeoutMs;
		while (!this.ready) {
			if (this.dead || Date.now() > deadline) {
				this.kill();
				throw new Error(`ego-browser REPL did not become ready within ${this.bootTimeoutMs}ms`);
			}
			await new Promise((resolve) => setTimeout(resolve, 50));
		}
	}
	flushBootWaiters() {
		for (const wake of this.bootWaiters.splice(0)) wake();
	}
	onChunk(chunk) {
		if (this.pending !== null) {
			this.pending.buffer += chunk;
			if (this.pending.buffer.length > this.stdoutCap) {
				this.pending.overflowed = true;
				this.pending.buffer = this.pending.buffer.slice(-this.stdoutCap);
			}
		} else {
			this.launchTail += chunk;
			if (this.launchTail.length > 16384) this.launchTail = this.launchTail.slice(-16384);
		}
		let idx = 0;
		while ((idx = chunk.indexOf(PROMPT, idx)) !== -1) {
			this.promptCount += 1;
			idx += 6;
		}
		if (!this.ready && (this.launchTail.includes("REPL") || this.promptCount > 0)) {
			this.ready = true;
			this.flushBootWaiters();
		}
		this.settlePendingIfComplete();
	}
	settlePendingIfComplete() {
		const req = this.pending;
		if (req === null) return;
		if (!(this.promptCount >= req.sentBaseline + 1)) return;
		this.pending = null;
		clearTimeout(req.timer);
		try {
			req.signal?.removeEventListener("abort", req.abortHandler);
		} catch {}
		if (req.overflowed) {
			req.resolve({
				ok: false,
				error: `REPL response exceeded ${this.stdoutCap} bytes; oldest output discarded`,
				stdout: req.buffer
			});
			return;
		}
		const value = extractLastSentinel(req.buffer);
		if (value === void 0) {
			req.resolve({
				ok: false,
				error: `REPL cell finished without a ${SENTINEL$1} payload`,
				stdout: req.buffer
			});
			return;
		}
		req.resolve({
			ok: true,
			value,
			stdout: req.buffer
		});
	}
	failPending(message) {
		const req = this.pending;
		if (req === null) return;
		this.pending = null;
		clearTimeout(req.timer);
		try {
			req.signal?.removeEventListener("abort", req.abortHandler);
		} catch {}
		req.resolve({
			ok: false,
			error: message,
			stdout: req.buffer
		});
	}
	async exec(script, opts) {
		if (!this.alive || !this.ready) throw new Error(REPL_DIED_ERROR);
		if (this.pending !== null) throw new Error("internal: overlapping REPL requests are not allowed");
		return new Promise((resolve) => {
			const baseline = this.promptCount;
			const req = {
				resolve,
				timer: setTimeout(() => {
					this.failPending(`REPL cell timed out after ${opts.timeoutMs}ms; session reset`);
					this.kill();
				}, opts.timeoutMs),
				sentBaseline: baseline,
				buffer: "",
				overflowed: false
			};
			if (opts.signal !== void 0) {
				req.signal = opts.signal;
				req.abortHandler = () => {
					this.failPending("ego-browser tool aborted (harness timeout or cancellation)");
					this.kill();
				};
				if (opts.signal.aborted) {
					resolve({
						ok: false,
						error: "aborted before dispatch",
						stdout: ""
					});
					clearTimeout(req.timer);
					return;
				}
				opts.signal.addEventListener("abort", req.abortHandler, { once: true });
			}
			this.pending = req;
			try {
				this.child.stdin.write(`.cell\n${wrapCell(script)}\n.end\n`);
			} catch (err) {
				this.failPending(`failed to write REPL input: ${String(err?.message ?? err)}`);
				this.kill();
			}
		});
	}
	kill() {
		const child = this.child;
		this.child = null;
		this.ready = false;
		this.dead = true;
		this.launchTail = "";
		if (child === void 0 || child === null) return;
		try {
			child.kill("SIGTERM");
		} catch {}
		const force = setTimeout(() => {
			try {
				child.kill("SIGKILL");
			} catch {}
		}, 3e3);
		force.unref?.();
		child.once("exit", () => clearTimeout(force));
	}
};

//#endregion
//#region src/app-facades.ts
/**
* app-facades — compat prelude for the OFFICIAL ego lite CLI flavor.
*
* The official binary binds FLAT helper functions (click/pageInfo/
* useOrCreateTaskSpace/js/cdp/drainEvents/...) into its `nodejs` heredoc
* scope, while this plugin's script builders speak the vendored shim's
* NAMESPACED surface (page.* / browser.* / taskSpaces.*). This prelude
* rebuilds the namespaced surface from the flat helpers so every existing
* builder works unchanged on either flavor. It is prepended to each script
* ONLY when engineFlavor==='app' (see runEgoScript) and installs once per
* process, yielding to any natively-bound namespace object.
*
* Signature sources: the skill doc shipped inside the installed app
* ("/Applications/ego lite.app/Contents/Resources/ego-browser/SKILL.md") and
* upstream package sources under .reference/ego-lite (helpers.ts,
* driver/*). Units caution: version-dependent wait semantics are avoided —
* every wait below polls with explicit millisecond sleeps via setTimeout.
*
* Kept backtick-free: embedded as plain TS string constants concatenated
* into one prelude.
*/
const HEAD = `
;(function installAppFacades(){
if (globalThis.__DSH_APP_COMPAT__) return
var G = globalThis
function need(name){
  var f = G[name]
  if (typeof f !== 'function') throw new Error('[ego-app-compat] official CLI does not expose helper: ' + name)
  return f
}
function sleep(ms){ return new Promise(function(res){ setTimeout(res, Math.max(0, Number(ms) || 0)) }) }
function matcher(v){
  if (v instanceof RegExp) return function(u){ return v.test(u) }
  var s = String(v)
  if (/^\\/.+\\/([gimsuy]*)$/.test(s)) {
    var lastSlash = s.lastIndexOf('/')
    try {
      var re = new RegExp(s.slice(1, lastSlash), s.slice(lastSlash + 1))
      return function(u){ return re.test(u) }
    } catch (_) { /* fall through to substring */ }
  }
  if (s.indexOf('*') >= 0) {
    var esc = s.replace(/[.+?^\${}()|[\\]\\\\]/g, '\\\\$&').replace(/\\*/g, '.*')
    var re2 = new RegExp('^' + esc + '$')
    return function(u){ return re2.test(u) }
  }
  return function(u){ return String(u).indexOf(s) >= 0 }
}
async function pollUntil(step, timeoutMs, everyMs){
  var deadline = Date.now() + (typeof timeoutMs === 'number' ? timeoutMs : 15000)
  for (;;) {
    var out = await step()
    if (out !== undefined && out !== null && out !== false) return out
    if (Date.now() > deadline) throw new Error('[ego-app-compat] waitFor timed out after ' + timeoutMs + 'ms')
    await sleep(everyMs || 250)
  }
}
async function drainedEventsSafe(){
  try { var e = await need('drainEvents')(); return Array.isArray(e) ? e : [] } catch (_) { return [] }
}
function jsEval(code){ return need('js')(code) }
function domOnce(selector, expr){
  var src = '(function(){ var el = document.querySelector(' + JSON.stringify(String(selector)) + '); return el ? (' + expr + ') : null })()'
  return jsEval(src)
}
`;
const LOCATOR = `
function makeLocator(selector){
  var L = {}
  L.selector = selector
  function opt(o){ return (o && typeof o === 'object' && o.label) ? { label: o.label } : {} }
  L.click = function(o){ return need('click')(selector, opt(o)) }
  L.dblclick = function(o){ return need('doubleClick')(selector, opt(o)) }
  L.hover = function(o){ return need('hover')(selector, opt(o)) }
  L.fill = function(v, o){ return need('fillInput')(selector, v, o || {}) }
  L.clear = function(){ return need('fillInput')(selector, '', {}) }
  L.type = function(t, o){ return need('typeText')(t, o || {}) }
  L.focusSel = async function(){ await domOnce(selector, '(el.focus ? el.focus() : null) || true') }
  L.press = async function(key, o){ await L.focusSel(); return need('pressKey')(key, o || {}) }
  L.pressSequentially = async function(text, o){ await L.focusSel(); return need('typeText')(text, o || {}) }
  L.check = function(){ return need('click')(selector, {}) }
  L.uncheck = function(){ return need('click')(selector, {}) }
  L.setChecked = async function(checked){
    var cur = await L.isChecked()
    if (!!cur !== !!checked) await need('click')(selector, {})
    return null
  }
  L.selectOption = async function(values){
    var payload = JSON.stringify(values == null ? [] : values)
    var src =
      '(function(){' +
      'var el=document.querySelector(' + JSON.stringify(String(selector)) + ');' +
      'if(!el||el.tagName!=="SELECT")throw new Error("selectOption target is not a <select>");' +
      'var wanted=' + payload + ';' +
      'var arr=Array.isArray(wanted)?wanted:[wanted];' +
      'var norm=arr.map(function(x){return (x&&typeof x==="object")?x:{value:String(x)}});' +
      'var chosen=[];' +
      'for(var i=0;i<el.options.length;i++){' +
      'var opt2=el.options[i];' +
      'for(var k=0;k<norm.length;k++){' +
      'var w=norm[k];' +
      'if((w.value!==undefined&&opt2.value===w.value)||(w.label!==undefined&&opt2.label===w.label))chosen.push(opt2)' +
      '}}' +
      'if(!chosen.length)return [];' +
      'el.selectedIndex=-1;' +
      'chosen.forEach(function(o){o.selected=true});' +
      'el.dispatchEvent(new Event("input",{bubbles:true}));' +
      'el.dispatchEvent(new Event("change",{bubbles:true}));' +
      'return chosen.map(function(o){return o.value})' +
      '})()'
    return jsEval(src)
  }
  L.setInputFiles = function(paths){ return need('uploadFile')(selector, paths) }
  L.dragTo = function(target){ return need('dragMouse')([selector, (target && target.selector) || target], {}) }
  L.scrollIntoViewIfNeeded = function(){ return domOnce(selector, '(el.scrollIntoView ? (el.scrollIntoView({block:"center"}), true) : true)') }
  L.focus = function(){ return domOnce(selector, '(el.focus ? (el.focus(), true) : true)') }
  L.blur = function(){ return domOnce(selector, '(el.blur ? (el.blur(), true) : true)') }
  L.textContent = function(){ return domOnce(selector, 'el.textContent') }
  L.innerText = function(){ return domOnce(selector, 'el.innerText') }
  L.innerHTML = function(){ return domOnce(selector, 'el.innerHTML') }
  L.inputValue = function(){ return domOnce(selector, '("value" in el ? el.value : null)') }
  L.getAttribute = function(name){ return domOnce(selector, 'el.getAttribute(' + JSON.stringify(String(name)) + ')') }
  L.isVisible = function(){ return domOnce(selector, '!!(el.offsetWidth || el.offsetHeight || el.getClientRects().length)') }
  L.isHidden = async function(){ return !(await L.isVisible()) }
  L.isEnabled = function(){ return domOnce(selector, '!el.disabled') }
  L.isDisabled = function(){ return domOnce(selector, '!!el.disabled') }
  L.isEditable = function(){ return domOnce(selector, '(!el.disabled && !el.readOnly)') }
  L.count = function(){ return jsEval('(function(){ return document.querySelectorAll(' + JSON.stringify(String(selector)) + ').length })()') }
  L.boundingBox = function(){ return domOnce(selector, '(function(b){ return b ? { x: b.x, y: b.y, width: b.width, height: b.height } : null })(el.getBoundingClientRect())') }
  L.dispatchEvent = function(type, init){ return need('dispatchEvent')(selector, type, init || {}) }
  L.waitFor = function(o){ return need('waitForElement')(selector, o || {}) }
  L.evaluate = async function(fnOrSrc, arg){
    var src = typeof fnOrSrc === 'function' ? '(' + fnOrSrc.toString() + ')' : String(fnOrSrc)
    var argSrc = arguments.length > 1 ? JSON.stringify(arg) : 'undefined'
    return jsEval('(function(){ var el = document.querySelector(' + JSON.stringify(String(selector)) + '); return (' + src + ')(el, ' + argSrc + ') })()')
  }
  L.screenshot = async function(opts){
    var cap = need('captureScreenshot')
    var p = (opts && typeof opts === 'object') ? opts.path : opts
    await L.scrollIntoViewIfNeeded()
    var box = await L.boundingBox()
    if (!box || !(box.width > 0 && box.height > 0)) throw new Error('locator.screenshot: element has no layout box: ' + selector)
    // No flat helper clips to a region: round-trip through CDP using the
    // viewport-relative rect obtained after scrolling the element into view.
    var res = await need('cdp')('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, clip: { x: box.x, y: box.y, width: Math.ceil(box.width), height: Math.ceil(box.height), scale: 1 } })
    var data = (res && typeof res === 'object') ? (res.data || (res.result && res.result.data)) : res
    if (typeof data !== 'string' || !data) throw new Error('locator.screenshot: unexpected CDP reply shape')
    var fsMod = await import('node:fs')
    var dest = (typeof p === 'string' && p) ? p : '/tmp/ego-element-shot-' + Date.now() + '.png'
    await fsMod.promises.writeFile(dest, data, 'base64')
    return dest
  }
  return L
}
`;
const PAGE = `
if (!G.taskSpaces) G.taskSpaces = {
  useOrCreate: function(n){ return need('useOrCreateTaskSpace')(n) },
  list: function(){ return need('listTaskSpaces')() },
  switch: function(n){ return need('switchTaskSpace')(n) },
  complete: function(id, opts){ return need('completeTaskSpace')(id, opts || { keep: false }) },
}
if (!G.browser) G.browser = {
  listTabs: function(o){ return need('listTabs')(o) },
  currentTab: function(){ return need('currentTab')() },
  switchTab: function(t){ return need('switchTab')(t) },
  closeTab: function(t){ return need('closeTab')(t) },
  ensureRealTab: function(){ return need('ensureRealTab')() },
  openOrReuseTab: function(url, o){ return need('openOrReuseTab')(url, o || {}) },
  goto: function(url, o){ return need('gotoAndWait')(url, o || {}) },
}
if (!G.page) {
  G.page = {
    info: function(){ return need('pageInfo')() },
    url: async function(){ return (await need('pageInfo')()).url },
    title: async function(){ return (await need('pageInfo')()).title },
    goto: function(url, o){ return need('gotoAndWait')(url, o || {}) },
    evaluate: function(fnOrSrc){
      if (typeof fnOrSrc === 'function') return jsEval('(' + fnOrSrc.toString() + ')()')
      return jsEval(String(fnOrSrc))
    },
    screenshot: async function(o){
      var cap = need('captureScreenshot')
      if (typeof o === 'string') return cap(o)
      // Installed ego lite binds captureScreenshot(pathString) ONLY: the
      // SKILL.md-documented {path} object reaches fs.writeFile as an Object
      // and throws ERR_INVALID_ARG_TYPE. Translate option objects down to
      // what this flavor honors ({path,x,y} selectors are ignored here);
      // no args saves to a tmp file and returns its path.
      if (o && typeof o.path === 'string' && o.path) return cap(o.path)
      return cap()
    },
    snapshot: function(o){ return need('snapshot')(o || {}) },
    snapshotRaw: function(o){ return need('snapshotRaw')(o || {}) },
    snapshotText: function(o){ return need('snapshotText')(o || {}) },
    elementCenter: function(s){ return need('elementCenter')(s) },
    drainEvents: function(){ return need('drainEvents')() },
    locator: makeLocator,
    getByRole: function(role){ return makeLocator('[role=' + JSON.stringify(String(role)) + ']') },
    keyboard: {
      press: function(k, o){ return need('pressKey')(k, o || {}) },
      type: function(t){ return need('typeText')(t, {}) },
      insertText: function(t){ return need('typeText')(t, {}) },
    },
    mouse: {
      click: function(x, y, o){ return need('click')([x, y], o || {}) },
      dblclick: function(x, y, o){ return need('doubleClick')([x, y], o || {}) },
      move: function(x, y){ return need('hover')([x, y], {}) },
      drag: function(points){ return need('dragMouse')(points, {}) },
      wheel: function(dx, dy){ return need('scroll')({ dx: dx || 0, dy: dy || 0 }) },
    },
    waitForTimeout: function(ms){ return sleep(ms) },
    waitForLoadState: function(o){ return need('waitForLoad')(o || {}) },
    waitForLoad: function(o){ return need('waitForLoad')(o || {}) },
    waitForNetworkIdle: function(o){ return need('waitForNetworkIdle')(o || {}) },
    waitForSelector: function(sel, o){
      var opts = o || {}
      var wantState = opts.state || 'visible'
      var timeout = typeof opts.timeout === 'number' ? opts.timeout : 15000
      return pollUntil(async function(){
        var vis = await domOnce(sel, '!!(el.offsetWidth || el.offsetHeight || el.getClientRects().length)')
        var exists = await domOnce(sel, 'true')
        if (wantState === 'hidden' || wantState === 'detached') return exists === null ? true : undefined
        if (wantState === 'attached') return exists ? true : undefined
        return (exists && vis) ? true : undefined
      }, timeout)
    },
    waitForURL: function(pattern, o){
      var m = matcher(pattern)
      var timeout = (o && typeof o.timeout === 'number') ? o.timeout : 15000
      return pollUntil(async function(){
        var pi = await need('pageInfo')()
        return (pi && pi.url && m(pi.url)) ? pi : undefined
      }, timeout)
    },
    waitForResponse: function(pattern, o){
      var m = matcher(pattern)
      var timeout = (o && typeof o.timeout === 'number') ? o.timeout : 15000
      return pollUntil(async function(){
        var events = await drainedEventsSafe()
        for (var i = 0; i < events.length; i++) {
          var e = events[i]
          var u = (e && (e.url || (e.params && e.params.url))) || ''
          if (u && m(u)) return e
        }
        return undefined
      }, timeout)
    },
    waitForEvent: function(type, o){
      var adaptedEvent = null
      var timeout = (o && typeof o.timeout === 'number') ? o.timeout : 15000
      return pollUntil(async function(){
        var events = await drainedEventsSafe()
        for (var i = 0; i < events.length; i++) {
          var e = events[i]
          var s = JSON.stringify(e)
          if (s && s.indexOf(String(type)) >= 0) { adaptedEvent = e; return e }
        }
        return undefined
      }, timeout).then(function(found){
        var d = found || {}
        return {
          path: async function(){ return (d.path ?? null) },
          saveAs: async function(dest){
            try {
              var fsMod = await import('node:fs')
              fsMod.copyFileSync(d.path, dest)
              return dest
            } catch (_) { return null }
          },
          suggestedFilename: function(){ return d.suggestedFilename || d.filename || null },
          url: function(){ return d.url || null },
        }
      })
    },
  }
}
if (!G.site) G.site = {
  skills: function(u){ return need('siteSkills')(u) },
  runTool: function(a, b, c){ return need('runSiteTool')(a, b, c) },
}
// ego_http / ego_cli document the namespaced fetch surface (fetch.browser,
// fetch.server), but the official CLI binds the native fetch FUNCTION plus
// FLAT serverFetch/browserFetch helpers. As a function, G.fetch already
// exists, so only attack the missing members onto it — this keeps raw
// fetch(url) calls intact while giving the builders a working .server/.browser.
if (!G.fetch) G.fetch = function(){ }
if (typeof G.fetch.server !== 'function') G.fetch.server = function(url, o){ return need('serverFetch')(url, o || {}) }
if (typeof G.fetch.browser !== 'function') G.fetch.browser = function(url, o){ return need('browserFetch')(url, o || {}) }

G.__DSH_APP_COMPAT__ = true
})();
`;
const APP_FACADE_PRELUDE = HEAD + LOCATOR + PAGE;
/** Wrap a builder-produced script with the app-flavor compat prelude. */
function withAppFacades(engineFlavor, script) {
	return engineFlavor === "app" ? APP_FACADE_PRELUDE + "\n" + script : script;
}

//#endregion
//#region src/util.ts
/**
* src/util.ts — shared small helpers (sentinel / type coercion / JSON helpers).
*
* Factored out of index.ts for reuse by other modules. No ctx/cfg dependency,
* no side effects.
*/
const SENTINEL = "@@DSH_RESULT@@";
const j = (v) => JSON.stringify(v);
const str = (v, fallback) => typeof v === "string" && v !== "" ? v : fallback;
const num = (v, fallback) => typeof v === "number" && Number.isFinite(v) ? v : fallback;
const bool = (v, fallback) => typeof v === "boolean" ? v : fallback;
/** Inline helper making arbitrary helper results JSON-safe for the payload. */
const SAFE_FN = "function safe(v){try{return JSON.parse(JSON.stringify(v))}catch{return String(v)}}\n";
/** Read an entire subprocess reader's buffered output. */
function readAll(reader) {
	if (!reader) return "";
	return reader.readFrom(0).text;
}

//#endregion
//#region src/index.ts
const name = "ego-browser";
const inject = ["tools", "subprocess"];
const Config = Config$1;
const DEFAULT_SPACE = "dsh-agent";
const DEFAULT_MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const DEFAULT_GRACE_MS = 15e3;
const TOOL_TIMEOUT_MS = 12e4;
/** Build the script that runs the probe and emits a sentinel payload. */
function humanCheckScript(space) {
	return `${useSpace(space)}${ensureRealTab()}let __hc = null\ntry { __hc = await page.evaluate(${j(HUMAN_CHECK_PROBE)}) } catch { __hc = null }\nconsole.log('${SENTINEL}' + JSON.stringify({ ok: true, humanCheck: __hc }))\n`;
}
function createActiveSpaceTracker(defaultSpace = DEFAULT_SPACE) {
	let activeSpace = defaultSpace;
	let activeName = typeof defaultSpace === "string" ? defaultSpace : null;
	return {
		current: () => activeSpace,
		opened: (args, result) => {
			activeName = result?.name ?? str(args?.name, defaultSpace) ?? null;
			activeSpace = result?.id ?? activeName ?? defaultSpace;
		},
		selected: (space) => {
			if (space !== void 0 && space !== "") {
				activeSpace = space;
				activeName = typeof space === "string" ? space : null;
			}
		},
		closed: (space, done) => {
			if (done && (String(space) === String(activeSpace) || activeName !== null && String(space) === String(activeName))) {
				activeSpace = defaultSpace;
				activeName = typeof defaultSpace === "string" ? defaultSpace : null;
			}
		}
	};
}
/**
* The ego-lite host is a single persistent browser shared by every tool call;
* concurrent tool executions would race on the same task space / tabs. All
* ego_* executions are therefore serialized through one in-process lock. This
* guards against concurrent tool calls within this plugin instance; separate
* harness sessions sharing the same browser remain unsupported (host-level).
*/
let egoLockChain = Promise.resolve();
function withEgoLock(fn) {
	const run = egoLockChain.then(() => fn(), () => fn());
	egoLockChain = run.then(() => void 0, () => void 0);
	return run;
}
/**
* Build the env handed to `ego-browser nodejs` spawns.
*
* The vendored ego-linux CLI reads EGO_LINUX_CHROME (bare Chrome binary/wrapper
* path) and EGO_LINUX_HEADLESS (=1 to run headless) from the process env. When a
* host does not set them — the common case on root / Docker / CI boxes — Chrome
* silently fails to start, and consumers see a 20s `DevTools port` timeout.
*
* This function makes the plugin self-sufficient WITHOUT touching the host or
* other plugins:
*
*  - It is a pure function: only reads the current process env, never mutates
*    it, never writes files, and returns a fresh env to pass to the one spawn.
*  - It INCREMENTALLY FILLS GAPS: it uses `??` on every value, so an env var the
*    user already set is always respected and never overridden ("user wins").
*  - It only compensates for missing pieces, so behavior on a correctly set-up
*    host is byte-for-byte identical to before.
*  - It is idempotent: the same env yields the same result every call.
*  - An opt-out switch EGO_BROWSER_AUTO_ADAPT (set to "0"/"false"/"no") restores
*    the original "inherit host env verbatim" behavior.
*/
const BUNDLED_WRAPPER = fileURLToPath(new URL("../bin/ego-chrome-wrapper.sh", import.meta.url));
const IS_WIN = process.platform === "win32";
const AUTO_ADAPT_OFF = /^(0|false|no)$/i.test(process.env.EGO_BROWSER_AUTO_ADAPT ?? "");
const COMMON_CHROME_BINS = [
	"google-chrome-stable",
	"google-chrome",
	"chromium",
	"chromium-browser",
	"/usr/bin/google-chrome-stable",
	"/usr/bin/google-chrome",
	"/usr/bin/chromium",
	"/usr/bin/chromium-browser",
	"/opt/google/chrome/google-chrome"
];
/** Windows registry-free probe of the usual install dirs (no subprocess). */
function windowsChromeCandidates() {
	const pf = process.env.ProgramFiles;
	const pfx86 = process.env["ProgramFiles(x86)"];
	const local = process.env.LOCALAPPDATA;
	local || `${process.env.USERPROFILE || process.env.HOME || ""}`;
	const b = (p) => p ? p.replace(/\\+$/, "") : p;
	return [
		b(pf) + "\\Google\\Chrome\\Application\\chrome.exe",
		b(pfx86) + "\\Google\\Chrome\\Application\\chrome.exe",
		b(local) + "\\Google\\Chrome\\Application\\chrome.exe",
		b(pf) + "\\Microsoft\\Edge\\Application\\msedge.exe",
		b(pfx86) + "\\Microsoft\\Edge\\Application\\msedge.exe",
		b(local) + "\\Microsoft\\Edge\\Application\\msedge.exe",
		b(pfx86) + "\\BraveSoftware\\Brave-Browser\\Application\\brave.exe",
		b(local) + "\\BraveSoftware\\Brave-Browser\\Application\\brave.exe"
	].filter(Boolean);
}
/** Find a usable Chrome binary by scanning PATH + common fixed locations. */
function findChromeBinary() {
	if (process.env.EGO_LINUX_CHROME) return process.env.EGO_LINUX_CHROME;
	if (IS_WIN) {
		for (const p of windowsChromeCandidates()) try {
			if (existsSync(p)) return p;
		} catch {}
		const exts = (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";").filter(Boolean).map((e) => e.startsWith(".") ? e.toLowerCase() : `.${e.toLowerCase()}`);
		const dirs = (process.env.PATH ?? "").split(";").map((d) => d.replace(/^"|"$/g, "")).filter(Boolean);
		for (const dir of dirs) for (const name$1 of [
			"chrome",
			"msedge",
			"brave"
		]) for (const ext of exts) try {
			const p = `${dir}\\${name$1}${ext}`;
			if (existsSync(p)) return p;
		} catch {}
		return;
	}
	for (const name$1 of COMMON_CHROME_BINS) if (name$1.includes("/")) try {
		if (existsSync(name$1)) return name$1;
	} catch {}
	else for (const dir of (process.env.PATH ?? "").split(":")) {
		if (!dir) continue;
		const p = `${dir}/${name$1}`;
		try {
			if (existsSync(p)) return p;
		} catch {}
	}
}
/** Root detection only makes sense on POSIX; Windows doesn't gate on sandbox. */
function isPosixRoot(platform$1 = process.platform) {
	const uid = process.getuid?.();
	return typeof uid === "number" && uid === 0 && platform$1 !== "win32";
}
/** No display server → headless is required (Linux/macOS headless servers). */
function isHeadlessDetected(platform$1 = process.platform, env = process.env) {
	if (platform$1 === "win32") return false;
	return env.DISPLAY === void 0 || env.DISPLAY === "";
}
/**
* Build the env handed to `ego-browser nodejs` spawns. See the block comment
* above ("environment self-adaptation") for the design contract.
*
* Platform/env are injectable for testing; production calls use process defaults.
*/
function resolveEgoEnv(cfg, { platform: platform$1 = process.platform, baseEnv = process.env } = {}) {
	if (AUTO_ADAPT_OFF) return baseEnv;
	const env = { ...baseEnv };
	const chrome = findChromeBinary();
	const configChrome = cfg?.chromePath;
	if (env.EGO_LINUX_CHROME === void 0 && configChrome) env.EGO_LINUX_CHROME = configChrome;
	if (env.EGO_LINUX_CHROME === void 0 && isPosixRoot(platform$1) && chrome) env.EGO_LINUX_CHROME = BUNDLED_WRAPPER;
	if (env.EGO_LINUX_CHROME === void 0 && platform$1 === "win32" && chrome) env.EGO_LINUX_CHROME = chrome;
	if (env.EGO_LINUX_HEADLESS === void 0 && isHeadlessDetected(platform$1, env)) env.EGO_LINUX_HEADLESS = "1";
	const configChromeArgs = cfg?.chromeArgs;
	if (env.EGO_LINUX_EXTRA_ARGS === void 0 && typeof configChromeArgs === "string" && configChromeArgs.trim() !== "") env.EGO_LINUX_EXTRA_ARGS = configChromeArgs;
	return env;
}
function describeStderr(stderr) {
	const tail = stderr.trim();
	return tail === "" ? "" : `\n--- ego-browser stderr (tail) ---\n${tail.slice(-2e3)}`;
}
function describeSpawnFailure(err) {
	const msg = err instanceof Error ? err.message : String(err);
	if (/ENOENT|spawn .* ENOENT|not found|could not load|cannot find module/i.test(msg)) return "ego-browser CLI could not be started. For the vendored runtime, make sure a Chrome/Chromium is reachable (PATH, or set EGO_LINUX_CHROME; root users need a --no-sandbox wrapper, see AGENTS.md). To use an official host instead, set egoBin to your `ego-browser` command. " + msg;
	return `failed to start ego-browser: ${msg}`;
}
/**
* Error signatures that indicate a TRANSIENT browser cold-start / channel
* not-yet-ready problem rather than a real defect. The ego-lite host is a
* single persistent Chromium that cold-starts on the first tool call of a
* session; a probe that arrives while the DevTools/CDP channel is still
* coming up can fail with one of these. Such failures are safe to retry
* briefly (the browser keeps warming up in the background). Anything else
* must pass through immediately — never mask a genuine error.
*/
const COLD_START_SIGNS = [
	/CDP channel is not open/i,
	/DevTools.*(port|timeout|active)/i,
	/could not connect to/i,
	/browser (was |is )?not (reachable|running|ready)/i,
	/target.*(closed|not found|detached|crashed)/i,
	/ECONNREFUSED/i,
	/REPL session terminated/i,
	/REPL cell timed out/i,
	/REPL did not become ready/i
];
function isColdStartError(message) {
	return COLD_START_SIGNS.some((re) => re.test(message));
}
/**
* Run `fn` (a per-call `ego-browser` spawn) up to `tries` times with a short
* backoff, retrying ONLY when the failure matches a transient cold-start
* signature. Real errors return on their first occurrence so they are never
* masked. Each retry re-spawns a fresh process, which is exactly what lets a
* warmed-up browser connect on a later attempt.
*/
async function withWarmupRetry(fn, { tries = 3, baseDelayMs = 600 } = {}) {
	let last;
	for (let i = 0; i < tries; i++) {
		const result = await fn();
		if (result.ok || !isColdStartError(result.error ?? "")) return result;
		last = result;
		if (i < tries - 1) await new Promise((resolve) => setTimeout(resolve, baseDelayMs * (i + 1)));
	}
	return last;
}
/** Find the last line carrying the sentinel and JSON-parse its payload. */
function parseSentinel(stdout) {
	const lines = stdout.split("\n");
	for (let i = lines.length - 1; i >= 0; i--) {
		const idx = lines[i].indexOf(SENTINEL);
		if (idx === -1) continue;
		const payload = lines[i].slice(idx + SENTINEL.length).trim();
		try {
			return JSON.parse(payload);
		} catch {
			return;
		}
	}
}
function engineOf(cfg) {
	return {
		flavor: cfg.engineFlavor,
		binPath: cfg.engineBin,
		jsRuntime: cfg.engineJsRuntime,
		origin: cfg.engineOrigin
	};
}
function noteReplFailure(cfg) {
	cfg.replFailures += 1;
	if (cfg.replFailures >= 2) cfg.replDisabled = true;
}
function disposeReplQuietly(cfg) {
	try {
		cfg.replSession?.kill();
	} catch {}
}
async function runEgoScript(subprocess, script, exec, cfg, graceOverrideMs) {
	const extraCliArgs = filterArgs(cfg.egoCliArgs ?? "", EGO_CLI_BLOCKED);
	if (cfg.replCapable && !cfg.replDisabled && cfg.execSession === "persistent") try {
		if (cfg.replSession === null || !cfg.replSession.alive) {
			cfg.replSession = new ReplSession(cfg.engineBin, Math.max(1e4, cfg.graceMs), cfg.maxOutputBytes);
			await cfg.replSession.launch();
			if (engineOf(cfg).flavor === "app") {
				const boot = await cfg.replSession.exec(withAppFacades("app", `console.log('${SENTINEL}' + JSON.stringify({ ok: true, compat: 'app-facades-installed' }))\n`), { timeoutMs: Math.min(TOOL_TIMEOUT_MS, 2e4) });
				if (!boot.ok) throw new Error(boot.error ?? "app facade compat failed to install");
			}
		}
		const r = await cfg.replSession.exec(script, {
			timeoutMs: TOOL_TIMEOUT_MS,
			maxOutputBytes: cfg.maxOutputBytes,
			signal: exec.signal
		});
		if (r.ok) cfg.replFailures = 0;
		else noteReplFailure(cfg);
		return {
			ok: r.ok,
			error: r.error,
			value: r.value,
			stdout: r.stdout,
			stderr: ""
		};
	} catch (err) {
		const message = String(err?.message ?? err);
		disposeReplQuietly(cfg);
		cfg.replSession = null;
		noteReplFailure(cfg);
		if (!isColdStartError(message)) cfg.replDisabled = true;
		return {
			ok: false,
			error: message,
			stdout: "",
			stderr: ""
		};
	}
	let handle;
	const engine = engineOf(cfg);
	const useEvalArgv = !engine.jsRuntime;
	try {
		handle = subprocess.spawn({
			argv: useEvalArgv ? [
				engine.binPath,
				...extraCliArgs,
				"nodejs",
				"-e",
				withAppFacades("app", script)
			] : buildSpawnArgv(engine, extraCliArgs, process.execPath),
			cwd: process.cwd(),
			env: engineEnv(engine, resolveEgoEnv(cfg)),
			stdio: {
				stdin: { data: useEvalArgv ? "" : withAppFacades(engine.flavor, script) },
				stdout: {
					maxBytes: cfg.maxOutputBytes,
					spill: { maxBytes: cfg.maxOutputBytes }
				},
				stderr: {
					maxBytes: 512e3,
					spill: { maxBytes: 2e6 }
				}
			},
			graceMs: Number.isFinite(graceOverrideMs) && graceOverrideMs > 0 ? graceOverrideMs : cfg.graceMs,
			...exec.signal !== void 0 ? { signal: exec.signal } : {}
		});
	} catch (err) {
		return {
			ok: false,
			error: describeSpawnFailure(err),
			stdout: "",
			stderr: ""
		};
	}
	let outcome;
	try {
		outcome = await handle.done;
	} catch (err) {
		return {
			ok: false,
			error: describeSpawnFailure(err),
			stdout: "",
			stderr: ""
		};
	}
	const stdout = readAll(handle.collected.stdout);
	const stderr = readAll(handle.collected.stderr);
	if (exec.signal !== void 0 && exec.signal.aborted) return {
		ok: false,
		error: "ego-browser tool aborted (harness timeout or cancellation)",
		stdout,
		stderr
	};
	if (outcome.exitCode !== 0) return {
		ok: false,
		error: /Cannot find module|MODULE_NOT_FOUND/i.test(stderr) ? describeSpawnFailure(/* @__PURE__ */ new Error(`node could not load ${cfg.engineBin}`)) : `ego-browser exited with ${outcome.exitCode !== null ? `code ${outcome.exitCode}` : `signal ${String(outcome.signal)}`}${describeStderr(stderr)}`,
		stdout,
		stderr
	};
	const value = parseSentinel(stdout) ?? parseSentinel(stderr);
	if (value === void 0) return {
		ok: false,
		error: `ego-browser finished but no ${SENTINEL} JSON payload was found on stdout/stderr${describeStderr(stderr)}`,
		stdout,
		stderr
	};
	return {
		ok: true,
		value,
		stdout,
		stderr
	};
}
/** JS snippet that pins an action tool to one task space. */
const useSpace = (name$1) => `const task = await taskSpaces.useOrCreate(${j(name$1)})\n`;
/**
* JS snippet that makes the harness act on a real page tab.
*
* The Linux host (PR #234 ego-linux) does not reliably persist "current tab"
* across CLI invocations: a fresh process sometimes resolves page actions
* against a blank/stale tab. Selecting the first non-blank tab in the space
* before acting makes cross-process tool calls deterministic.
*/
const ensureRealTab = () => "const __tabs = await browser.listTabs()\nconst __real = __tabs.find(t => !t.url.startsWith('about:') && !t.url.startsWith('chrome://')) ?? __tabs[0]\nif (__real) await browser.switchTab(__real.targetId)\n";
function renderText(_args, value) {
	const v = value;
	if (v !== null && typeof v === "object" && v.ok === true && typeof v.text === "string") return [{
		type: "text",
		text: v.text
	}];
	return [{
		type: "text",
		text: JSON.stringify(value, null, 2)
	}];
}
const commonOutputSchema = {
	type: "object",
	additionalProperties: true,
	properties: { ok: {
		type: "boolean",
		required: true
	} }
};
function defineEgoTool(ctx, cfg, opts) {
	return defineTool({
		name: opts.name,
		description: opts.description,
		parameters: opts.parameters,
		output: {
			schema: commonOutputSchema,
			render: renderText
		},
		timeoutMs: TOOL_TIMEOUT_MS,
		execute: async (args, exec) => withEgoLock(async () => {
			const script = opts.buildScript(args);
			const result = await withWarmupRetry(() => runEgoScript(ctx.subprocess, script, exec, cfg));
			if (!result.ok) throw new Error(result.error);
			if (typeof opts.afterExecute === "function") opts.afterExecute(args, result.value);
			return result.value;
		}),
		presentCall: () => ({
			card: "generic",
			title: opts.name,
			kind: "other",
			rawInput: null
		})
	});
}
function apply(ctx, config = {}) {
	const bridge = installEgoBrowserSettings(ctx, Object.fromEntries([
		"chromePath",
		"egoCliArgs",
		"chromeArgs",
		"engineMode",
		"execSession"
	].filter((key) => config[key] !== void 0).map((key) => [key, config[key]])));
	const spaceTracker = createActiveSpaceTracker(config.defaultSpace ?? DEFAULT_SPACE);
	const initialResolved = resolveConfig(bridge.source());
	const engine = resolveEngine({
		configuredEgoBin: typeof config.egoBin === "string" && config.egoBin !== "" ? config.egoBin : void 0,
		engineMode: initialResolved.engineMode
	});
	ctx.logger?.info?.(`ego-browser: engine=${engine.flavor} (${engine.origin}) session=${initialResolved.execSession} replCapable=${replSupported(engine.flavor)}`);
	const cfg = {
		egoBin: engine.binPath,
		engineFlavor: engine.flavor,
		engineBin: engine.binPath,
		engineJsRuntime: engine.jsRuntime,
		engineOrigin: engine.origin,
		get execSession() {
			return resolveConfig(bridge.source()).execSession;
		},
		replCapable: replSupported(engine.flavor),
		replSession: null,
		replFailures: 0,
		replDisabled: false,
		engineMode: initialResolved.engineMode,
		configuredDefaultSpace: config.defaultSpace ?? DEFAULT_SPACE,
		spaceTracker,
		get defaultSpace() {
			return this.spaceTracker.current();
		},
		maxOutputBytes: config.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
		graceMs: config.graceMs ?? DEFAULT_GRACE_MS,
		get chromePath() {
			return resolveConfig(bridge.source()).chromePath;
		},
		get egoCliArgs() {
			return resolveConfig(bridge.source()).egoCliArgs;
		},
		get chromeArgs() {
			return resolveConfig(bridge.source()).chromeArgs;
		}
	};
	const reg = (tool) => {
		const dispose = ctx.tools.register(tool);
		ctx.effect?.(() => dispose);
	};
	registerEgoStatus(ctx, cfg, reg);
	registerAuthFlush(ctx, cfg, reg);
	registerActionTools(ctx, cfg, reg);
	registerHelpAndDoctor(ctx, cfg, reg);
	ctx.effect?.(() => {
		disposeReplQuietly(cfg);
		if (cfg.engineFlavor !== "vendored") return;
		try {
			ctx.subprocess.spawn({
				argv: [
					...cfg.engineJsRuntime ? [process.execPath] : [],
					cfg.engineBin,
					"--stop"
				],
				cwd: process.cwd(),
				env: resolveEgoEnv(cfg),
				stdio: {
					stdin: { data: "" },
					stdout: { maxBytes: 1024 },
					stderr: { maxBytes: 1024 }
				},
				graceMs: 8e3
			}).done.catch(() => {});
		} catch {}
	});
	ctx.logger?.info?.(`ego-browser: mounted (flavor=${cfg.engineFlavor} via ${cfg.engineOrigin}, bin=${cfg.engineBin}, defaultSpace=${cfg.defaultSpace})`);
}
/** `ego_status` probes CLI availability by running the real `--status` path. */
function registerEgoStatus(ctx, cfg, reg) {
	reg(defineTool({
		name: "ego_status",
		description: "Check whether the ego-browser CLI is usable (runs a real CLI roundtrip; auto-detects the official ego lite app vs the vendored runtime). Use this first when other ego_* tools report \"CLI not found\".",
		parameters: {},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					ok: {
						type: "boolean",
						required: true
					},
					available: {
						type: "boolean",
						required: true
					},
					path: { type: "string" },
					exitCode: { type: "integer" },
					error: { type: "string" }
				}
			},
			render: renderText
		},
		timeoutMs: 25e3,
		execute: async () => withEgoLock(async () => {
			if (!cfg.engineJsRuntime) try {
				const r = await runEgoScript(ctx.subprocess, `console.log('${SENTINEL}' + JSON.stringify({ ok: true, probe: 'ping' }))\n`, { signal: void 0 }, cfg);
				const bootOk = r.ok && r.value?.ok === true;
				return {
					ok: true,
					available: bootOk,
					path: cfg.engineBin,
					exitCode: bootOk ? 0 : 1,
					...bootOk ? {} : { error: r.error ?? "ping cell returned no sentinel payload" }
				};
			} catch (err) {
				return {
					ok: true,
					available: false,
					path: cfg.engineBin,
					exitCode: 1,
					error: describeSpawnFailure(err)
				};
			}
			try {
				const handle = ctx.subprocess.spawn({
					argv: [
						process.execPath,
						cfg.engineBin,
						"--status"
					],
					cwd: process.cwd(),
					env: engineEnv(engineOf(cfg), resolveEgoEnv(cfg)),
					stdio: {
						stdin: { data: "" },
						stdout: { maxBytes: 4096 },
						stderr: { maxBytes: 4096 }
					},
					graceMs: 25e3
				});
				const outcome = await handle.done;
				const out = readAll(handle.collected.stdout).trim();
				return {
					ok: true,
					available: outcome.exitCode === 0 && out !== "",
					path: cfg.engineBin,
					exitCode: outcome.exitCode
				};
			} catch (err) {
				return {
					ok: true,
					available: false,
					path: "",
					exitCode: null,
					error: describeSpawnFailure(err)
				};
			}
		}),
		presentCall: () => ({
			card: "generic",
			title: "ego_status",
			kind: "other",
			rawInput: null
		})
	}));
}
/** `ego_auth_flush` — force persistent login cookies down to the disk profile. */
function registerAuthFlush(ctx, cfg, reg) {
	reg(defineTool({
		name: "ego_auth_flush",
		description: "Force all persistent login cookies in the agent browser to be written to the on-disk profile. Call this after login (or before ending a browsing task) so the login survives a later DSH/browser restart — Chrome only flushes cookies to disk on graceful close, this nudges it to persist them now.",
		parameters: {},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					ok: {
						type: "boolean",
						required: true
					},
					total: { type: "integer" },
					flushed: { type: "integer" },
					error: { type: "string" }
				}
			},
			render: renderText
		},
		timeoutMs: 1e4,
		execute: async () => withEgoLock(async () => {
			try {
				const { readFile } = await import("node:fs/promises");
				const e = process.env;
				const isWin = process.platform === "win32";
				const home = e.HOME || e.USERPROFILE || (isWin ? e.LOCALAPPDATA || "" : homedir());
				const stateDir = e.EGO_LINUX_STATE_DIR || (isWin ? (e.LOCALAPPDATA || `${home}\\AppData\\Local`) + "\\ego-lite-linux" : `${e.XDG_STATE_HOME || `${home}/.local/state`}/ego-lite-linux`);
				let port = null;
				try {
					const state = JSON.parse(await readFile(`${stateDir}/ego-cast.json`, "utf8"));
					port = typeof state.port === "number" ? state.port : null;
				} catch {
					port = null;
				}
				if (port === null) return {
					ok: false,
					error: "no live ego-cast worker (browser not running)"
				};
				const jbody = await (await fetch(`http://127.0.0.1:${port}/api/flush`, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: "{}",
					signal: AbortSignal.timeout(8e3)
				})).json();
				return {
					ok: !!jbody.ok,
					total: jbody.total ?? 0,
					flushed: jbody.flushed ?? 0,
					error: jbody.error
				};
			} catch (err) {
				return {
					ok: false,
					error: String(err?.message || err)
				};
			}
		}),
		presentCall: () => ({
			card: "generic",
			title: "ego_auth_flush",
			kind: "other",
			rawInput: null
		})
	}));
}
/** The structured action tools that drive `ego-browser nodejs`. */
function registerActionTools(ctx, cfg, reg) {
	const t = (opts) => defineEgoTool(ctx, cfg, {
		...opts,
		afterExecute: (args, result) => {
			if (!result || result.ok === false) return;
			if (opts.name === "ego_space_open") cfg.spaceTracker.opened(args, result);
			else if (opts.name === "ego_space_close") cfg.spaceTracker.closed(args.name, result.done);
			else if (args && args.space !== void 0 && args.space !== "") cfg.spaceTracker.selected(args.space);
			opts.afterExecute?.(args, result);
		}
	});
	const spaceParam = {
		type: "string",
		description: "Task-space name or numeric id; defaults to the most recently opened or explicitly selected space."
	};
	reg(t({
		name: "ego_space_open",
		description: "Open (or reuse) an ego-lite task space — an isolated browsing context that inherits your login state. It becomes the active space for later ego_* calls that omit `space`. Reuse the same space for follow-ups on the same goal; ALWAYS call ego_space_close when the goal is done — never leave a space hanging.",
		parameters: { name: {
			type: "string",
			required: true,
			description: "Short name for the active user goal, e.g. \"search github issues\". Reuse the same name for follow-ups on the same goal."
		} },
		buildScript: (args) => `${useSpace(str(args.name, cfg.defaultSpace))}console.log('${SENTINEL}' + JSON.stringify({ ok: true, id: task.id ?? null, name: task.name ?? ${j(str(args.name, cfg.defaultSpace))}, note: ${j("reuse this space for follow-ups; when the goal is done run ego_space_close (keep defaults to false)")} }))\n`
	}));
	reg(t({
		name: "ego_space_close",
		description: "Complete (close) an ego-lite task space. Must be the final ego_* call for a task — never leave a space hanging. Policy: `keep` defaults to FALSE — close the space after completion unless the user explicitly asked to keep the page open, the task needs manual user action in that exact page, or the result cannot be delivered as a file/artifact/summary. Merely having visited a page or used it for verification is NOT a reason to keep.",
		parameters: {
			name: {
				type: "string",
				required: true,
				description: "Task-space name or numeric id to close."
			},
			keep: {
				type: "boolean",
				description: "Keep the live page open (default false). Only set true for the concrete reasons above; when keeping, first close scratch tabs so only pages worth showing remain."
			}
		},
		buildScript: (args) => `const res = await taskSpaces.complete(${j(str(args.name, cfg.defaultSpace))}, { keep: ${bool(args.keep, false)} })\nconsole.log('${SENTINEL}' + JSON.stringify({ ok: true, done: !!res.done, skipped: !!res.skipped, reason: res.skipped ? ${j("target space was not agent-owned")} : null }))\n`
	}));
	reg(t({
		name: "ego_snapshot",
		description: "Read the current page as text: the full-page semantic tree annotated with [ref=N, loc=...] selectors that ego_click / ego_fill can target. This is the main observation tool for any browser task.",
		parameters: {
			space: spaceParam,
			scope: {
				type: "string",
				description: "snapshot scope: 'full_page' (default) or 'only_within_viewport'."
			}
		},
		buildScript: (args) => {
			const scope = str(args.scope, "");
			const call = scope === "" ? "await page.snapshotRaw()" : `await page.snapshotRaw({ scope: ${j(scope)} })`;
			return `${useSpace(str(args.space, cfg.defaultSpace))}${ensureRealTab()}let s = ${call}\nlet tries = 0\nwhile (!(s.content ?? '') && tries < 3) { await page.waitForTimeout(400); s = ${call}; tries++ }\nconst text = s.content ?? ''\nconsole.log('${SENTINEL}' + JSON.stringify(text === ''\n  ? { ok: false, text, tries, reason: 'snapshot returned no content after retries (page may be blank, still loading, or the browser dropped)' }\n  : { ok: true, text, tries }))\n`;
		}
	}));
	reg(t({
		name: "ego_navigate",
		description: "Open a URL in the task space, or switch to the existing tab for it. Waits for the document to load. Returns the resulting page info.",
		parameters: {
			url: {
				type: "string",
				required: true,
				description: "Absolute URL to open, e.g. https://example.com/path."
			},
			wait: {
				type: "boolean",
				description: "Wait for document load (default true)."
			},
			timeout: {
				type: "number",
				description: "Load wait timeout in ms (default 20000)."
			},
			space: spaceParam
		},
		buildScript: (args) => {
			const u = str(args.url, "");
			if (u === "") return `console.log('${SENTINEL}' + JSON.stringify({ ok: false, reused: false, page: null, reason: 'ego_navigate: url is required' }))\n`;
			return `${useSpace(str(args.space, cfg.defaultSpace))}${ensureRealTab()}const __existing = __tabs.find(t => t.url.split('#')[0] === ${j(u.split("#")[0])})\nconst tab = __existing ? await browser.switchTab(__existing.targetId) : await page.goto(${j(u)}, { wait: ${bool(args.wait, true)}, timeout: ${num(args.timeout, 2e4)} })\nconst pginfo = await page.info()\nconsole.log('${SENTINEL}' + JSON.stringify({ ok: true, reused: !!__existing, page: pginfo }))\n`;
		}
	}));
	reg(t({
		name: "ego_click",
		description: "Click an element in the current page. Target with a CSS selector, an xpath=.../loc=.../ref=@N value from ego_snapshot, or viewport coordinates.",
		parameters: {
			selector: {
				type: "string",
				description: "CSS selector, xpath=..., loc=..., or ref=@N from the snapshot. Required unless x/y are given."
			},
			x: {
				type: "number",
				description: "Viewport x coordinate for a coordinate click."
			},
			y: {
				type: "number",
				description: "Viewport y coordinate for a coordinate click."
			},
			label: {
				type: "string",
				description: "Short human label for the action, e.g. \"click submit button\"."
			},
			double: {
				type: "boolean",
				description: "Double-click instead of single-click. Useful for opening files/rows or triggering dblclick handlers."
			},
			space: spaceParam
		},
		buildScript: (args) => {
			const sel = str(args.selector, "");
			const x = args.x;
			const y = args.y;
			if (sel === "" && !(typeof x === "number" && typeof y === "number")) throw new Error("ego_click: provide either `selector` (CSS/xpath/loc/ref from ego_snapshot) or both `x` and `y` viewport coordinates");
			const dbl = bool(args.double, false);
			let action;
			if (sel !== "") {
				const labelOpt = str(args.label, "") !== "" ? `{ label: ${j(str(args.label, ""))} }` : "";
				action = dbl ? `await page.locator(${j(sel)}).dblclick(${labelOpt})` : `await page.locator(${j(sel)}).click(${labelOpt})`;
			} else action = dbl ? `await page.mouse.dblclick(${x}, ${y})` : `await page.mouse.click(${x}, ${y})`;
			return `${useSpace(str(args.space, cfg.defaultSpace))}${ensureRealTab()}${action}\nconst pginfo = await page.info()\nconsole.log('${SENTINEL}' + JSON.stringify({ ok: true, double: ${dbl}, page: pginfo }))\n`;
		}
	}));
	reg(t({
		name: "ego_fill",
		description: "Type text into an input field. Target with a CSS selector, xpath=..., loc=..., or ref=@N from ego_snapshot.",
		parameters: {
			selector: {
				type: "string",
				required: true,
				description: "CSS selector, xpath=..., loc=..., or ref=@N for the input."
			},
			text: {
				type: "string",
				required: true,
				description: "Text to type into the field."
			},
			space: spaceParam
		},
		buildScript: (args) => `${useSpace(str(args.space, cfg.defaultSpace))}${ensureRealTab()}await page.locator(${j(str(args.selector, ""))}).fill(${j(str(args.text, ""))})\nconst pginfo = await page.info()\nconsole.log('${SENTINEL}' + JSON.stringify({ ok: true, page: pginfo }))\n`
	}));
	reg(t({
		name: "ego_js",
		description: "Evaluate a JavaScript expression in the current page and return its JSON-serializable value (e.g. \"document.title\", \"document.querySelectorAll('a').length\").",
		parameters: {
			expression: {
				type: "string",
				required: true,
				description: "JavaScript expression string to evaluate in the page."
			},
			space: spaceParam
		},
		buildScript: (args) => `${useSpace(str(args.space, cfg.defaultSpace))}${ensureRealTab()}${SAFE_FN}const result = await page.evaluate(${j(str(args.expression, ""))})\nconsole.log('${SENTINEL}' + JSON.stringify({ ok: true, result: safe(result) }))\n`
	}));
	reg(t({
		name: "ego_cdp",
		description: "Issue a raw CDP command on the page target, e.g. cdp(\"Page.handleJavaScriptDialog\", { accept: true }).",
		parameters: {
			method: {
				type: "string",
				required: true,
				description: "CDP method name, e.g. Page.handleJavaScriptDialog."
			},
			params: {
				type: "object",
				additionalProperties: true,
				description: "CDP method parameters object."
			},
			space: spaceParam
		},
		buildScript: (args) => {
			const params = args.params;
			const call = params !== void 0 && params !== null ? `await cdp(${j(str(args.method, ""))}, ${j(params)})` : `await cdp(${j(str(args.method, ""))})`;
			return `${useSpace(str(args.space, cfg.defaultSpace))}${ensureRealTab()}${SAFE_FN}const result = ${call}\nconsole.log('${SENTINEL}' + JSON.stringify({ ok: true, result: safe(result) }))\n`;
		}
	}));
	reg(t({
		name: "ego_screenshot",
		description: "Capture a screenshot of the current page (or of a single element if selector is given). Returns the file path of the saved PNG, which you can then read with a vision/image tool.",
		parameters: {
			selector: {
				type: "string",
				description: "Optional CSS selector of an element to screenshot instead of the whole page."
			},
			path: {
				type: "string",
				description: "Optional absolute output path for the PNG."
			},
			space: spaceParam
		},
		buildScript: (args) => {
			const sel = str(args.selector, "");
			const pth = str(args.path, "");
			const shot = sel !== "" ? `await page.locator(${j(sel)}).screenshot(${pth ? `{ path: ${j(pth)} }` : ""})` : `await page.screenshot(${pth ? `{ path: ${j(pth)} }` : ""})`;
			return `${useSpace(str(args.space, cfg.defaultSpace))}${ensureRealTab()}const path = ${shot}\nconsole.log('${SENTINEL}' + JSON.stringify({ ok: true, path }))\n`;
		}
	}));
	reg(t({
		name: "ego_page_info",
		description: "Return the current page info: url, title, viewport size (w, h), scroll offsets (sx, sy), device metrics (pw, ph), and whether a native dialog is open. Also reports `humanCheck` — whether a CAPTCHA / human-verification challenge is detected on the page (so the agent can alert the user to complete it).",
		parameters: { space: spaceParam },
		buildScript: (args) => `${useSpace(str(args.space, cfg.defaultSpace))}${ensureRealTab()}const pginfo = await page.info()\nlet __hc = null\ntry { __hc = await page.evaluate(${j(HUMAN_CHECK_PROBE)}).catch(() => null); } catch { __hc = null }\nconsole.log('${SENTINEL}' + JSON.stringify({ ok: true, page: pginfo, humanCheck: __hc }))\n`
	}));
	reg(t({
		name: "ego_wait",
		description: "Pause for a fixed number of milliseconds (e.g. for animations or partial loads). For load waits prefer ego_navigate's wait option.",
		parameters: { ms: {
			type: "number",
			required: true,
			description: "Milliseconds to wait."
		} },
		buildScript: (args) => `await page.waitForTimeout(${Math.max(0, num(args.ms, 1e3))})\nconsole.log('${SENTINEL}' + JSON.stringify({ ok: true, waitedMs: ${Math.max(0, num(args.ms, 1e3))} }))\n`
	}));
	reg(t({
		name: "ego_wait_for_selector",
		description: "Wait until an element matching a CSS selector appears (state=visible, default) or disappears (state=hidden). Use instead of a blind fixed wait when a page renders asynchronously.",
		parameters: {
			selector: {
				type: "string",
				required: true,
				description: "CSS selector of the element to wait for, e.g. '.results' or '[data-id=done]'."
			},
			state: {
				type: "string",
				description: "Target state: 'visible' (default) | 'attached' | 'hidden' | 'detached'."
			},
			timeout: {
				type: "number",
				description: "How long to wait in ms (default 10000)."
			},
			space: spaceParam
		},
		buildScript: (args) => {
			const sel = str(args.selector, "").trim();
			if (sel === "") return `console.log('${SENTINEL}' + JSON.stringify({ ok: false, waited: false, reason: 'ego_wait_for_selector: selector is required' }))\n`;
			return `${useSpace(str(args.space, cfg.defaultSpace))}${ensureRealTab()}await page.waitForSelector(${j(sel)}, { state: ${j(str(args.state, "visible"))}, timeout: ${num(args.timeout, 1e4)} })\nconsole.log('${SENTINEL}' + JSON.stringify({ ok: true, waited: true, selector: ${j(sel)}, state: ${j(str(args.state, "visible"))} }))\n`;
		}
	}));
	reg(t({
		name: "ego_wait_for_url",
		description: "Wait until the page navigates to a URL matching a substring / glob / regex. Use to catch login redirects or pagination.",
		parameters: {
			pattern: {
				type: "string",
				required: true,
				description: "URL/glob to match (e.g. '/login?done', 'https://*/post/*', or a /regex/)."
			},
			timeout: {
				type: "number",
				description: "How long to wait in ms (default 10000)."
			},
			space: spaceParam
		},
		buildScript: (args) => {
			const p = str(args.pattern, "").trim();
			if (p === "") return `console.log('${SENTINEL}' + JSON.stringify({ ok: false, reached: false, reason: 'ego_wait_for_url: pattern is required' }))\n`;
			return `${useSpace(str(args.space, cfg.defaultSpace))}${ensureRealTab()}const __ok = await page.waitForURL(${j(p)}, { timeout: ${num(args.timeout, 1e4)} }).catch(() => false)\nconst __u = await page.url()\nconsole.log('${SENTINEL}' + JSON.stringify({ ok: !!__ok, reached: !!__ok, url: __u }))\n`;
		}
	}));
	reg(t({
		name: "ego_wait_for_response",
		description: "Wait for a network response matching a URL/glob/regex and return it. Optionally return the body (text or JSON) — ideal for scraping API responses or confirming a submission.",
		parameters: {
			url: {
				type: "string",
				required: true,
				description: "URL/glob/regex to match, e.g. '/api/search' or 'https://*.com/data'."
			},
			timeout: {
				type: "number",
				description: "How long to wait in ms (default 10000)."
			},
			body: {
				type: "string",
				description: "Return the response body: 'none' (default) | 'text' | 'json'."
			},
			space: spaceParam
		},
		buildScript: (args) => {
			const u = str(args.url, "").trim();
			const mode = str(args.body, "none");
			const wantBody = mode === "text" || mode === "json";
			return `${useSpace(str(args.space, cfg.defaultSpace))}${ensureRealTab()}const __res = await page.waitForResponse(${j(u)}, { timeout: ${num(args.timeout, 1e4)} })\n${wantBody ? `const __body = ${mode === "json" ? "await __res.json().catch(()=>null)" : "await __res.text().catch(()=>null)"}\n` : ""}console.log('${SENTINEL}' + JSON.stringify({ ok: true, url: __res.url(), status: __res.status()${wantBody ? ", body: __body" : ""} }))\n`;
		}
	}));
	reg(t({
		name: "ego_key",
		description: "Press a keyboard key or shortcut combination on the current page, e.g. 'Enter', 'Tab', 'Control+a', 'Escape', 'ArrowDown'. Useful for forms, shortcuts and navigation. Pass `text` to type a string of characters instead (keyboard.type).",
		parameters: {
			key: {
				type: "string",
				description: "Key or combo: 'Enter', 'Tab', 'Control+c', 'Meta+v', 'ArrowDown', 'Escape', 'F5', etc. (ignored when `text` is given)."
			},
			text: {
				type: "string",
				description: "Type this text character-by-character (keyboard.type). Use instead of `key` for typing words into the focused element."
			},
			space: spaceParam
		},
		buildScript: (args) => {
			const txt = str(args.text, "");
			const k = str(args.key, "").trim();
			if (txt !== "") return `${useSpace(str(args.space, cfg.defaultSpace))}${ensureRealTab()}await page.keyboard.type(${j(txt)})\nconsole.log('${SENTINEL}' + JSON.stringify({ ok: true, typed: ${j(txt)} }))\n`;
			if (k === "") return `console.log('${SENTINEL}' + JSON.stringify({ ok: false, reason: 'ego_key: provide key or text to type' }))\n`;
			return `${useSpace(str(args.space, cfg.defaultSpace))}${ensureRealTab()}await page.keyboard.press(${j(k)})\nconsole.log('${SENTINEL}' + JSON.stringify({ ok: true, key: ${j(k)} }))\n`;
		}
	}));
	reg(t({
		name: "ego_hover",
		description: "Move the pointer over an element (CSS selector / ref) or to viewport coordinates. Triggers CSS :hover, dropdowns and mouseenter handlers.",
		parameters: {
			selector: {
				type: "string",
				description: "CSS selector, xpath=..., loc=..., or ref=@N for the element."
			},
			x: {
				type: "number",
				description: "Viewport x (only with y)."
			},
			y: {
				type: "number",
				description: "Viewport y (only with x)."
			},
			space: spaceParam
		},
		buildScript: (args) => {
			const sel = str(args.selector, "");
			const hasXY = typeof args.x === "number" && typeof args.y === "number";
			if (sel === "" && !hasXY) return `console.log('${SENTINEL}' + JSON.stringify({ ok: false, reason: 'ego_hover: provide selector or both x and y' }))\n`;
			return `${useSpace(str(args.space, cfg.defaultSpace))}${ensureRealTab()}` + (sel !== "" ? `await page.locator(${j(sel)}).hover()\n` : `await page.mouse.move(${args.x}, ${args.y})\n`) + `console.log('${SENTINEL}' + JSON.stringify({ ok: true }))\n`;
		}
	}));
	reg(t({
		name: "ego_read_element",
		description: "Read a single element (by selector): its text, HTML, input value, an attribute, or visibility/enabled/count. Cheaper and more precise than a full-page snapshot.",
		parameters: {
			selector: {
				type: "string",
				required: true,
				description: "CSS selector of the target element."
			},
			what: {
				type: "string",
				description: "What to read: 'text' (default) | 'html' | 'value' | 'attribute' | 'visible' | 'enabled' | 'count'."
			},
			attribute: {
				type: "string",
				description: "Attribute name when what=attribute."
			},
			space: spaceParam
		},
		buildScript: (args) => {
			const sel = str(args.selector, "").trim();
			const what = str(args.what, "text");
			if (sel === "") return `console.log('${SENTINEL}' + JSON.stringify({ ok: false, reason: 'ego_read_element: selector is required' }))\n`;
			const selExpr = `page.locator(${j(sel)})`;
			let expr;
			switch (what) {
				case "html":
					expr = `await ${selExpr}.innerHTML()`;
					break;
				case "value":
					expr = `await ${selExpr}.inputValue()`;
					break;
				case "attribute":
					expr = `await ${selExpr}.getAttribute(${j(str(args.attribute, ""))})`;
					break;
				case "visible":
					expr = `await ${selExpr}.isVisible()`;
					break;
				case "enabled":
					expr = `await ${selExpr}.isEnabled()`;
					break;
				case "count":
					expr = `await ${selExpr}.count()`;
					break;
				default: expr = `await ${selExpr}.textContent()`;
			}
			return `${useSpace(str(args.space, cfg.defaultSpace))}${ensureRealTab()}${SAFE_FN}const __v = ${expr}\nconsole.log('${SENTINEL}' + JSON.stringify({ ok: true, what: ${j(what)}, selector: ${j(sel)}, value: safe(__v) }))\n`;
		}
	}));
	reg(t({
		name: "ego_select",
		description: "Choose an option in a <select> dropdown by value, label, or index (a single value or an array for multi-select).",
		parameters: {
			selector: {
				type: "string",
				required: true,
				description: "CSS selector of the <select> element."
			},
			value: {
				type: "json",
				description: "The option: a string value/label, or {value:'..'}, {label:'..'}, {index:n}, or an array of these for multi-select."
			},
			space: spaceParam
		},
		buildScript: (args) => `${useSpace(str(args.space, cfg.defaultSpace))}${ensureRealTab()}await page.locator(${j(str(args.selector, ""))}).selectOption(${j(args.value ?? "")})\nconsole.log('${SENTINEL}' + JSON.stringify({ ok: true, select: ${j(str(args.selector, ""))} }))\n`
	}));
	reg(t({
		name: "ego_drag",
		description: "Drag an element to a target (Playwright dragTo) or drag the pointer through coordinates. Use for sliders, sortable rows, and drag-drop zones.",
		parameters: {
			from: {
				type: "string",
				description: "CSS selector of the element to drag from."
			},
			to: {
				type: "string",
				description: "CSS selector of the drop target (used with from)."
			},
			points: {
				type: "array",
				items: { type: "number" },
				description: "Alternative: a flat list of [x1,y1,x2,y2,...] viewport coordinates to drag the mouse through."
			},
			space: spaceParam
		},
		buildScript: (args) => {
			const pts = Array.isArray(args.points) ? args.points.map(Number).filter((n) => Number.isFinite(n)) : [];
			const hasEl = str(args.from, "") !== "" && str(args.to, "") !== "";
			if (!hasEl && pts.length < 4) return `console.log('${SENTINEL}' + JSON.stringify({ ok: false, reason: 'ego_drag: provide from+to selectors, or at least 4 points (x1,y1,x2,y2)' }))\n`;
			const action = hasEl ? `await page.locator(${j(str(args.from, ""))}).dragTo(page.locator(${j(str(args.to, ""))}))\n` : `const __pts = ${j(pts)}\nconst __coords=[];for(let __i=0;__i<__pts.length;__i+=2){__coords.push([__pts[__i],__pts[__i+1]])}\nawait page.mouse.drag(__coords)\n`;
			return `${useSpace(str(args.space, cfg.defaultSpace))}${ensureRealTab()}` + action + `console.log('${SENTINEL}' + JSON.stringify({ ok: true }))\n`;
		}
	}));
	reg(t({
		name: "ego_scroll",
		description: "Scroll the page: by pixel deltas (wheel), or bring an element into view (scrollIntoView).",
		parameters: {
			deltaX: {
				type: "number",
				description: "Horizontal scroll delta (wheel) in px."
			},
			deltaY: {
				type: "number",
				description: "Vertical scroll delta (wheel) in px."
			},
			selector: {
				type: "string",
				description: "CSS selector to scroll into view (primary if given)."
			},
			space: spaceParam
		},
		buildScript: (args) => {
			const hasSelector = str(args.selector, "") !== "";
			const hasDelta = Number.isFinite(args.deltaX) || Number.isFinite(args.deltaY);
			if (!hasSelector && !hasDelta) return `console.log('${SENTINEL}' + JSON.stringify({ ok: false, reason: 'ego_scroll: provide deltaX/deltaY or a selector' }))\n`;
			const action = hasSelector ? `await page.locator(${j(str(args.selector, ""))}).scrollIntoViewIfNeeded()\n` : `await page.mouse.wheel(${num(args.deltaX, 0)}, ${num(args.deltaY, 300)})\n`;
			return `${useSpace(str(args.space, cfg.defaultSpace))}${ensureRealTab()}` + action + `const __p = await page.info()\nconsole.log('${SENTINEL}' + JSON.stringify({ ok: true, scrollX: __p.sx ?? null, scrollY: __p.sy ?? null }))\n`;
		}
	}));
	reg(t({
		name: "ego_upload",
		description: "Set files on a file <input> element (path-driven). Use to upload a dataset/attachment from a local path.",
		parameters: {
			selector: {
				type: "string",
				required: true,
				description: "CSS selector of the <input type=file> element."
			},
			path: {
				type: "string",
				required: true,
				description: "Absolute path of the file(s) to upload on this machine."
			},
			space: spaceParam
		},
		buildScript: (args) => `${useSpace(str(args.space, cfg.defaultSpace))}${ensureRealTab()}await page.locator(${j(str(args.selector, ""))}).setInputFiles(${j(str(args.path, ""))})\nconsole.log('${SENTINEL}' + JSON.stringify({ ok: true, upload: ${j(str(args.selector, ""))} }))\n`
	}));
	reg(t({
		name: "ego_download",
		description: "Wait for a file download triggered by the current action, then return its saved path. Provide `triggerSelector` (a download button/link to click) or `triggerScript` (arbitrary JS that triggers the download). The file is captured into a temp dir and (optionally) copied to `savePath`. Returns { path, suggestedFilename, url }.",
		parameters: {
			triggerSelector: {
				type: "string",
				description: "CSS selector of the element (button/link) whose click starts the download."
			},
			triggerScript: {
				type: "string",
				description: "Full JS snippet that triggers the download (e.g. window.open() or a fetch-to-blob download); runs in the page before waiting for the download."
			},
			savePath: {
				type: "string",
				description: "Optional absolute destination path to also copy the downloaded file to. Otherwise only the temp-captured path is returned."
			},
			timeout: {
				type: "number",
				description: "How long to wait for the download in ms (default 30000)."
			},
			space: spaceParam
		},
		buildScript: (args) => {
			const sel = str(args.triggerSelector, "");
			const script = str(args.triggerScript, "");
			const savePath = str(args.savePath, "");
			const timeout = num(args.timeout, 3e4);
			const trigger = sel !== "" ? `await page.locator(${j(sel)}).click()\n` : script !== "" ? `await page.evaluate(() => { ${script} })\n` : "/* no trigger given — the download may be started by an earlier navigation */\n";
			const save = savePath !== "" ? `const __final = await __dl.saveAs(${j(savePath)}).catch(()=>null)\n` : `const __final = await __dl.path().catch(()=>null)\n`;
			return `${useSpace(str(args.space, cfg.defaultSpace))}${ensureRealTab()}const __dlPromise = page.waitForEvent('download', { timeout: ${timeout} })\n` + trigger + "const __dl = await __dlPromise\nconst __name = typeof __dl.suggestedFilename === 'function' ? __dl.suggestedFilename() : null\nconst __url = typeof __dl.url === 'function' ? __dl.url() : null\n" + save + `console.log('${SENTINEL}' + JSON.stringify({ ok: true, path: __final, suggestedFilename: __name, url: __url }))\n`;
		}
	}));
	reg(t({
		name: "ego_check",
		description: "Check (tick) or uncheck a checkbox/radio element. Does nothing if already in the desired state.",
		parameters: {
			selector: {
				type: "string",
				required: true,
				description: "CSS selector of the checkbox/radio."
			},
			checked: {
				type: "boolean",
				description: "true=check (default), false=uncheck."
			},
			space: spaceParam
		},
		buildScript: (args) => {
			const chk = bool(args.checked, true);
			return `${useSpace(str(args.space, cfg.defaultSpace))}${ensureRealTab()}await page.locator(${j(str(args.selector, ""))}).${chk ? "check" : "uncheck"}()\nconsole.log('${SENTINEL}' + JSON.stringify({ ok: true, checked: ${chk} }))\n`;
		}
	}));
	reg(t({
		name: "ego_dialog",
		description: "Accept or dismiss a native browser dialog (alert/confirm/prompt), optionally supplying text for a prompt. Use right after the action that triggers the dialog.",
		parameters: {
			accept: {
				type: "boolean",
				description: "true=Accept/OK (default), false=Dismiss/Cancel."
			},
			text: {
				type: "string",
				description: "Text to type into a prompt dialog."
			},
			space: spaceParam
		},
		buildScript: (args) => {
			const accept = bool(args.accept, true);
			const text = str(args.text, "");
			const params = `{ accept: ${accept}${text !== "" ? `, promptText: ${j(text)}` : ""} }`;
			return `${useSpace(str(args.space, cfg.defaultSpace))}${ensureRealTab()}const __r = await cdp("Page.handleJavaScriptDialog", ${params}).catch((e) => ({ error: String(e) }))\nconst __ok = !!(__r && !__r.error)\nconsole.log('${SENTINEL}' + JSON.stringify({ ok: true, handled: __ok, accept: ${accept}, error: __r?.error ?? null }))\n`;
		}
	}));
	reg(t({
		name: "ego_http",
		description: "Make an HTTP request and return status + body. Default runs in the agent page's browser context (cross-origin allowed when the server's CORS permits); set `mode: server` to use Node-side fetch.server. Use to scrape an API, POST data, or hit a service. (Note: on the vendored ego-linux Windows runtime, fetch.server can hit a libuv crash, so prefer the default browser mode there.)",
		parameters: {
			url: {
				type: "string",
				required: true,
				description: "Absolute URL to request."
			},
			method: {
				type: "string",
				description: "HTTP method, default GET."
			},
			headers: {
				type: "object",
				additionalProperties: true,
				description: "Request headers, e.g. { 'Content-Type': 'application/json' }."
			},
			body: {
				type: "string",
				description: "Request body (for POST/PUT)."
			},
			timeout: {
				type: "number",
				description: "Timeout in ms (default 20000)."
			},
			mode: {
				type: "string",
				description: "'browser' (default) runs via the page context; 'server' uses Node-side fetch.server."
			},
			space: spaceParam
		},
		buildScript: (args) => {
			const opts = {
				method: str(args.method, "GET"),
				headers: args.headers && typeof args.headers === "object" ? args.headers : {},
				timeout: num(args.timeout, 2e4)
			};
			if (str(args.body, "") !== "") opts.body = str(args.body, "");
			const mode = str(args.mode, "browser");
			return `${mode === "server" ? "" : `${useSpace(str(args.space, cfg.defaultSpace))}${ensureRealTab()}`}${SAFE_FN}const __r = await fetch.${mode === "server" ? "server" : "browser"}(${j(str(args.url, ""))}, ${j(opts)})\nconst __status = typeof __r.status !== "undefined" ? __r.status : 200\nlet __body = null\ntry { __body = typeof __r.text === "function" ? await __r.text() : (typeof __r === "string" ? __r : JSON.stringify(safe(__r))) } catch { __body = null }\nconsole.log('${SENTINEL}' + JSON.stringify({ ok: true, mode: ${j(mode)}, status: __status, body: __body, url: ${j(str(args.url, ""))} }))\n`;
		}
	}));
	reg((() => {
		return defineTool({
			name: "ego_cli",
			description: "Escape hatch: run an arbitrary `ego-browser nodejs` heredoc script verbatim (facades page/browser/taskSpaces/site/fetch and the raw cdp() are preloaded). Use when the structured ego_* tools do not cover the task. Returns raw stdout plus the parsed console.log payload when present.",
			parameters: { script: {
				type: "string",
				required: true,
				description: "Full JS script body for the heredoc; ego-browser helpers are preloaded. End with console.log(JSON.stringify(...)) for a parseable sentinel payload."
			} },
			output: {
				schema: {
					type: "object",
					additionalProperties: false,
					properties: {
						ok: {
							type: "boolean",
							required: true
						},
						stdout: {
							type: "string",
							required: true
						},
						stderr: { type: "string" },
						result: { type: "json" }
					}
				},
				render: renderText
			},
			timeoutMs: TOOL_TIMEOUT_MS,
			execute: async (args, exec) => {
				const script = str(args.script, "");
				const result = await withWarmupRetry(() => runEgoScript(ctx.subprocess, script, exec, cfg));
				if (!result.ok) throw new Error(result.error);
				const parsed = parseSentinel(result.stdout);
				return {
					ok: true,
					stdout: result.stdout,
					stderr: result.stderr,
					result: parsed ?? null
				};
			},
			presentCall: () => ({
				card: "generic",
				title: "ego_cli",
				kind: "other",
				rawInput: null
			})
		});
	})());
}
/** Register ego_help / ego_doctor / ego_script. */
function registerHelpAndDoctor(ctx, cfg, reg) {
	reg(defineTool({
		name: "ego_captcha",
		description: "Check the current page for a human-verification (CAPTCHA) challenge — reCAPTCHA / hCaptcha / Cloudflare / Turnstile — and return { detected, kind }. If detected=true, ALERT THE USER that they must complete the verification in the 'ego lite - agent' browser window (it is the same live session shown in the watch panel), then continue after they have.",
		parameters: { space: {
			type: "string",
			description: "Task-space name or numeric id; defaults to the configured defaultSpace."
		} },
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					ok: {
						type: "boolean",
						required: true
					},
					detected: {
						type: "boolean",
						required: true
					},
					kind: { oneOf: [{ type: "string" }, { type: "null" }] }
				}
			},
			render: renderText
		},
		timeoutMs: 15e3,
		execute: async (args, exec) => withEgoLock(async () => {
			const result = await withWarmupRetry(() => runEgoScript(ctx.subprocess, humanCheckScript(str(args.space, cfg.defaultSpace)), { signal: exec?.signal }, cfg));
			if (!result.ok) return {
				ok: false,
				detected: false,
				kind: null,
				error: result.error
			};
			const hc = (parseSentinel(result.stdout) || {}).humanCheck;
			return {
				ok: true,
				detected: !!hc?.detected,
				kind: hc?.kind ?? null
			};
		}),
		presentCall: () => ({
			card: "generic",
			title: "ego_captcha",
			kind: "other",
			rawInput: null
		})
	}));
	reg(defineTool({
		name: "ego_help",
		description: "Query the built-in ego-browser tool guide. `topic` may be a category (overview/tools/navigate/observe/input/keyboard-mouse/form/wait/network/login/script/doctor) or a specific tool name (e.g. ego_click). Returns the matching usage notes. Call this when unsure which eyebrow tool to use.",
		parameters: { topic: {
			type: "string",
			description: "Category or tool name to look up; omitted/all returns the overview index."
		} },
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					ok: {
						type: "boolean",
						required: true
					},
					topic: {
						type: "string",
						required: true
					},
					text: {
						type: "string",
						required: true
					}
				}
			},
			render: renderText
		},
		timeoutMs: 1e4,
		execute: async (args) => {
			const q = str(args.topic, "").trim().toLowerCase();
			const key = Object.prototype.hasOwnProperty.call(EGO_HELP_INDEX, q) ? q : "";
			const text = key ? EGO_HELP_INDEX[key] : q ? `未找到 topic "${q}"。可用: ` + Object.keys(EGO_HELP_INDEX).filter((k) => k !== "overview").join(", ") + "\n\noverview: " + EGO_HELP_INDEX.overview : EGO_HELP_INDEX.overview;
			return {
				ok: true,
				topic: q || "overview",
				text
			};
		},
		presentCall: () => ({
			card: "generic",
			title: "ego_help",
			kind: "other",
			rawInput: null
		})
	}));
	reg(defineTool({
		name: "ego_doctor",
		description: "Preflight the ego-browser environment: vendored runtime present, Chrome/Edge/Brave candidates, state dir, CDP/browser.json, ego-cast worker, task spaces. Run first when the browser fails to start (update, reboot, port conflict) or before a long session.",
		parameters: {},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					ok: {
						type: "boolean",
						required: true
					},
					report: {
						type: "string",
						required: true
					}
				}
			},
			render: renderText
		},
		timeoutMs: 25e3,
		execute: async () => {
			const lines = [];
			lines.push(`engine: ${cfg.engineFlavor} via ${cfg.engineOrigin}`);
			lines.push(`egoBin: ${cfg.egoBin}`);
			try {
				lines.push(`egoBin exists: ${existsSync(cfg.egoBin)}`);
			} catch {
				lines.push("egoBin exists: n/a");
			}
			const chrome = findChromeBinary();
			const configured = cfg.chromePath;
			if (configured) lines.push(`browser binary: ${configured} (from settings)`);
			else lines.push(`browser binary: ${chrome || "(none found — set chromePath in settings, or set EGO_LINUX_CHROME, or install Chrome/Edge/Brave)"}`);
			const cliArgs = filterArgs(cfg.egoCliArgs ?? "", EGO_CLI_BLOCKED);
			const chrArgs = filterArgs(cfg.chromeArgs ?? "", CHROME_BLOCKED);
			lines.push(`egoCliArgs (effective): ${cliArgs.length ? cliArgs.join(" ") : "(none)"}`);
			lines.push(`chromeArgs (effective, next cold start): ${chrArgs.length ? chrArgs.join(" ") : "(none)"}`);
			const isWin = process.platform === "win32";
			const e = process.env;
			const home = e.HOME || e.USERPROFILE || (isWin ? e.LOCALAPPDATA || "" : homedir());
			const stateDir = e.EGO_LINUX_STATE_DIR || (isWin ? (e.LOCALAPPDATA || `${home}\\AppData\\Local`) + "\\ego-lite-linux" : `${e.XDG_STATE_HOME || `${home}/.local/state`}/ego-lite-linux`);
			lines.push(`state dir: ${stateDir} (exists: ${existsSync(stateDir)})`);
			const bjson = `${stateDir}/browser.json`;
			let browserReport = "browser.json: (none — agent browser not running)";
			if (existsSync(bjson)) try {
				const { readFile } = await import("node:fs/promises");
				const b = JSON.parse(await readFile(bjson, "utf8"));
				const alive = b.pid ? await (async () => {
					try {
						process.kill(b.pid, 0);
						return true;
					} catch (x) {
						return x?.code === "EPERM";
					}
				})() : false;
				browserReport = `browser.json: port=${b.port} pid=${b.pid} alive=${alive} headless=${b.headless}`;
			} catch (err) {
				browserReport = `browser.json: unreadable (${err?.message})`;
			}
			lines.push(browserReport);
			const tjson = `${stateDir}/task-spaces.json`;
			if (existsSync(tjson)) try {
				const { readFile } = await import("node:fs/promises");
				const t = JSON.parse(await readFile(tjson, "utf8"));
				lines.push(`task spaces: ${(t.spaces || []).length}`);
			} catch {}
			lines.push("headless override: " + (e.EGO_LINUX_HEADLESS ? "yes (" + e.EGO_LINUX_HEADLESS + ")" : "no"));
			lines.push("npm/node: " + process.version);
			return {
				ok: true,
				report: lines.join("\n")
			};
		},
		presentCall: () => ({
			card: "generic",
			title: "ego_doctor",
			kind: "other",
			rawInput: null
		})
	}));
	reg((() => {
		return defineTool({
			name: "ego_script",
			description: "Run an arbitrary `ego-browser nodejs` heredoc script in ONE invocation (same runtime/API as ego_cli: page/…locator/browser/taskSpaces/site/fetch/cdp preloaded), and return structured {ok, stdout, stderr, result, durationMs, timedOut}. Use for a full multi-step browser task as a single script.",
			parameters: {
				script: {
					type: "string",
					required: true,
					description: "Full JS script body; end with console.log(JSON.stringify(...)) for a parseable sentinel payload."
				},
				timeoutMs: {
					type: "integer",
					description: "Per-run timeout in ms (default plugin grace)."
				}
			},
			output: {
				schema: {
					type: "object",
					additionalProperties: false,
					properties: {
						ok: {
							type: "boolean",
							required: true
						},
						stdout: {
							type: "string",
							required: true
						},
						stderr: { type: "string" },
						result: { type: "json" },
						durationMs: { type: "integer" },
						timedOut: { type: "boolean" },
						error: { type: "string" }
					}
				},
				render: renderText
			},
			timeoutMs: TOOL_TIMEOUT_MS,
			execute: async (args, exec) => {
				const script = str(args.script, "");
				const timeoutMs = typeof args.timeoutMs === "number" && Number.isFinite(args.timeoutMs) && args.timeoutMs > 0 ? args.timeoutMs : void 0;
				const start = Date.now();
				const result = await withWarmupRetry(() => runEgoScript(ctx.subprocess, script, exec, cfg, timeoutMs));
				const durationMs = Date.now() - start;
				if (!result.ok) return {
					ok: false,
					stdout: result.stdout,
					stderr: result.stderr,
					durationMs,
					timedOut: false,
					error: result.error
				};
				const parsed = parseSentinel(result.stdout);
				return {
					ok: true,
					stdout: result.stdout,
					stderr: result.stderr,
					result: parsed ?? null,
					durationMs,
					timedOut: false
				};
			},
			presentCall: () => ({
				card: "generic",
				title: "ego_script",
				kind: "other",
				rawInput: null
			})
		});
	})());
}

//#endregion
export { Config, apply, createActiveSpaceTracker, findChromeBinary, inject, name, resolveEgoEnv };