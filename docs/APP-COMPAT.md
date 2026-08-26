# App-flavor compatibility guide

How this plugin drives the **official ego lite desktop app** (preferred engine)
versus the **vendored runtime**, and exactly what the compatibility layer
(`src/app-facades.ts`) reconstructs on the app flavor.

Measured against ego lite **0.4.7.3** (macOS arm64).

## Engine selection (`src/engine.ts`)

| Priority | Candidate | Flavor |
| --- | --- | --- |
| 0 | configured `egoBin` setting that exists | `app` or `vendored` (by shape) |
| 1 | `~/.local/bin/ego-browser` (app onboarding symlink) | `app` |
| 2 | `ego lite.app/Contents/Frameworks/*/Versions/{Current,\|highest}/Helpers/ego-browser` | `app` |
| 3 | vendored `runtime/ego-linux/bin/ego-browser.mjs` (needs a JS prefix) | `vendored` |

The app flavor never launches a browser of its own — every script attaches to
the user's running app. The vendored flavor keeps working wherever the app is
not installed (Linux/Windows/CI).

## Transports (`runEgoScript` in `src/index.ts`)

| | app flavor | vendored flavor |
| --- | --- | --- |
| Invocation | `ego-browser nodejs -e "<script>"` (argv) | `[node] ego-browser.mjs nodejs < stdin` |
| Full facades+navigation roundtrip | **~0.5 s** typical | ~0.25 s ping; navigation depends on Chrome |
| Stdin dependency | none | heredoc protocol |
| Embedded console output lands on | **stderr** (fd1 reserved by CLI) | stdout |
| Sentinel parsing | stdout first, stderr fallback | stdout |

Stress evidence (2026-08-27): 15 consecutive `-e` roundtrips incl. real
navigation — 15/15 ok, p≈0.52 s, one 3.1 s outlier, **zero leftover
processes** afterwards.

The legacy persistent REPL (`execSession: 'persistent'`, `src/repl-session.ts`)
is OPT-IN ONLY: driving `/usr/bin/script` from a Node spawn fails because our
stdin is a socketpair (`script: tcgetattr/ioctl: Operation not supported on
socket`), and `-e` already makes persistence unnecessary at ~0.5 s per call.

## Facade surface on the app flavor

The official CLI binds FLAT helpers (`useOrCreateTaskSpace`, `click`, `js`,
`drainEvents`, …); the vendored shim exposes NAMESPACED objects
(`page.*` / `browser.*` / `taskSpaces.*`). Tool builders speak the namespaced
dialect, so `APP_FACADE_PRELUDE` is prepended to every app-flavor script and
rebuilds the namespaces once per process (guard-style: yields if the runtime
ever binds them natively).

### Direct mappings (official helper behind, 1:1)

- `taskSpaces.useOrCreate/list/switch/complete`
- `browser.listTabs/currentTab/switchTab/closeTab/ensureRealTab/openOrReuseTab/goto`
- `page.info/url/title/goto/screenshot/snapshot{,Raw,Text}/elementCenter/drainEvents`
- `page.waitForLoadState/waitForNetworkIdle`
- `site.skills/runTool`; flat `js`, `cdp`, `scroll`, `scrollBy`, `uploadFile`,
  `dispatchEvent`, `click/doubleClick/hover/fillInput/typeText/pressKey/
  dragMouse` used verbatim by builders.

### Reconstructed via compat layer

| Callsite | Implementation |
| --- | --- |
| `page.evaluate(fn)` | `js('(' + fn.toString() + ')()')` — zero-arg channel only (upstream `js()` wraps toString) |
| `locator.*` clicks/fill/hover | flat `click/doubleClick/hover/fillInput` |
| `locator.press/pressSequentially` | focus via `js` then `pressKey/typeText` |
| `locator.selectOption(values)` | `js()` IIFE that matches options by value/label, sets selection, fires input+change events |
| `locator.setInputFiles` | flat `uploadFile` |
| `locator.dragTo` | flat `dragMouse([from, to])` |
| element state reads (`textContent/innerText/innerHTML/inputValue/getAttribute/isVisible/isHidden/isEnabled/isDisabled/isEditable/count/boundingBox`) | `domOnce` `js()` expressions; `boundingBox` wraps `getBoundingClientRect()` |
| `page.getByRole(role)` | CSS `[role="…"]` locator (approximation, not an ARIA query) |
| `page.keyboard.press/type/insertText` | `pressKey/typeText` |
| `page.mouse.click/dblclick/move/drag/wheel` | coordinate forms of `click/doubleClick/hover/dragMouse/scroll` |
| `page.waitForTimeout(ms)` | millisecond sleep (avoids version-dependent `wait()` units) |
| `page.waitForSelector(sel, {state, timeout})` | poll loop over `domOnce` visibility/attached probes, ms timeouts |
| `page.waitForURL(pattern)` | `pageInfo` polling; matcher supports substring / `*` glob / `/regex/` |
| `page.waitForResponse(pattern)` | `drainEvents` polling on event URL |
| `page.waitForEvent('download', …)` | `drainEvents` polling → adapted event `{ path(), saveAs(dest) (fs.copyFileSync), suggestedFilename(), url() }` |

Polling runs every 250 ms; waits throw a tagged timeout error after their
budget instead of returning ambiguous nulls.

### Known deltas vs the vendored flavor

- Waits are poll-based (no push events); sub-250 ms reactivity does not exist.
- `waitForResponse` sees only events drained after the call starts.
- `getByRole` is a CSS approximation.
- `captureScreenshot` is bound as `captureScreenshot(pathString)` in installed
  builds — the SKILL.md-documented `{path, ...}` object form reaches
  `fs.writeFile` as an Object and throws `ERR_INVALID_ARG_TYPE`. The compat
  layer translates option objects to the string form; calls without a path
  use the no-arg tmp-file form.
- `page.locator(sel).screenshot({path})` does not exist on this flavor; the
  compat layer implements it as scrollIntoView + viewport-relative
  `Page.captureScreenshot` clip (via the flat `cdp()` helper) + base64
  write-through, so element shots match the layout box at device pixel ratio.

## Availability probe

`ego_status` auto-detects the flavor:

- **app**: a real one-shot `-e` ping cell (~0.2 s healthy). The official binary
  has NO `--status` subcommand (exits 2) and `--doctor` does not exist either.
- **vendored**: native `--status` path of the shim.

Both report `{ok, available, path, exitCode[, error]}`; failures carry the
spawn/parse error detail.
