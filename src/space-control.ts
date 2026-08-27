/**
 * space-control — script builders for the v0.9.3 full-parity tool set.
 *
 * These builders close the remaining gaps against the official ego-browser
 * skill (SKILL.md v1.2.3, ~41 helpers): the task-space control handoff family
 * (claim / handOff / takeOver / waitForAgentControl / list), tab-level tools
 * (list / switch / close), infinite-scroll (scrollToBottomUntil equivalent),
 * load / network-idle waits, synthetic key dispatch, and a carrier for the
 * official `learnings` site-tool packs (siteSkills / runSiteTool).
 *
 * Engine policy — "flat first, namespace fallback": the official CLI binds
 * FLAT helpers into its heredoc scope (helpers.ts in .reference/ego-lite) and
 * both flavors share that harness, so flat names exist everywhere; the
 * vendored shim additionally exposes namespace objects. Every helper call
 * goes through SPACE_PICKER_FN so scripts run unchanged on either flavor,
 * without depending on APP_FACADE_PRELUDE extensions.
 *
 * Signature sources (exact, .reference/ego-lite/package/ego-browser/src/helpers.ts):
 *   listTaskSpaces()                                             -> TaskSpace[]
 *   claimTaskSpace(nameOrId)                                     -> TaskSpace (claims ownership AND selects it)
 *   handOffTaskSpace(nameOrId?)                                  -> {done?, skipped?, reason?...} — CHECK done/skipped
 *   takeOverTaskSpace(nameOrId?)                                 -> TaskSpace
 *   waitForAgentControl(nameOrId, {interval?=20, timeout?=600})  — SECONDS; throws on timeout
 *
 * Units: tool schemas speak MILLISECONDS (plugin-wide convention); the
 * wait-control builder converts to the helper's seconds. Scroll and wait
 * builders self-implement their loops in the Node layer (deterministic on
 * both flavors, no waitForNetworkIdle signature guessing).
 *
 * Generated JS is kept backtick-free, mirroring app-facades.ts style.
 */

/** Sentinel shared with the tool transport (same literal as repl-session). */
export const SPACE_CONTROL_SENTINEL = '@@DSH_RESULT@@'

/** JSON.stringify helper for generated snippets. */
export const j = (v: unknown): string => JSON.stringify(v)

/**
 * Picks a helper by flat name first, then from a namespace object. Both
 * flavors share the official harness's flat bindings; the picker is pure
 * belt-and-braces against future flavor drift.
 */
export const SPACE_PICKER_FN = `function __dshPick(flat, nsObj, nsKey){
  if (typeof flat === 'function') return flat
  if (nsObj && typeof nsObj[nsKey] === 'function') return nsObj[nsKey].bind(nsObj)
  throw new Error('[dsh-ego-lite] engine exposes neither the ' + nsKey + ' flat helper nor a namespace member')
}
`

const LIST_EXPR =
  `__dshPick(typeof listTaskSpaces === 'function' ? listTaskSpaces : null, typeof taskSpaces !== 'undefined' ? taskSpaces : null, 'list')`

/** Lists all spaces into `__spaces` (used by every target-resolving builder). */
export const LIST_SPACES_HEAD = SPACE_PICKER_FN + `var __spaces = await ` + LIST_EXPR + `\n`

/**
 * Resolves an EXISTING task space by name or id into `__target`. Deliberately
 * never creates: control-handoff operations must not materialise a space as a
 * side effect (mirrors the RESOLVE_SPACE fallback discipline in index.ts).
 */
export function buildSpaceResolveSnippet(target: string | number): string {
  return (
    `var __target = __spaces.find(function(s){ return String(s.id) === String(${j(target)}) || String(s.name) === String(${j(target)}) })\n` +
    `if (!__target) throw new Error(${j(
      `task space not found: ${target} — run ego_space_list to see existing spaces`,
    )})\n`
  )
}

const pickLine = (flat: string, nsKey: string): string =>
  `var __op = __dshPick(typeof ${flat} === 'function' ? ${flat} : null, typeof taskSpaces !== 'undefined' ? taskSpaces : null, ${j(nsKey)})\n`

/** ego_space_list — inventory of every task space (name/id/ownership/createdBy). */
export function buildSpaceListScript(): string {
  return (
    LIST_SPACES_HEAD +
    `console.log('${SPACE_CONTROL_SENTINEL}' + JSON.stringify({ ok: true, count: __spaces.length, spaces: __spaces }))\n`
  )
}

/** ego_space_claim — claim ownership of a space AND select it (official semantics). */
export function buildSpaceClaimScript(target: string | number): string {
  return (
    LIST_SPACES_HEAD +
    buildSpaceResolveSnippet(target) +
    pickLine('claimTaskSpace', 'claim') +
    `var __r = await __op(__target.id ?? __target.name)\n` +
    `console.log('${SPACE_CONTROL_SENTINEL}' + JSON.stringify({ ok: true, space: __r, note: 'ownership transferred to the agent and the space is selected; close it with ego_space_close when done' }))\n`
  )
}

/** ego_space_handoff — hand the space to the user; they act in the GUI. */
export function buildSpaceHandoffScript(target: string | number | null): string {
  const head = target === null ? SPACE_PICKER_FN : LIST_SPACES_HEAD
  const resolve = target === null ? '' : buildSpaceResolveSnippet(target)
  const call =
    target === null
      ? `var __r = await __op()\n`
      : `var __r = await __op(__target.id ?? __target.name)\n`
  return (
    head +
    resolve +
    pickLine('handOffTaskSpace', 'handOff') +
    call +
    `var __done = !!(__r && __r.done !== false && !__r.skipped)\n` +
    `console.log('${SPACE_CONTROL_SENTINEL}' + JSON.stringify({ ok: true, done: __done, raw: __r, note: __done ? ${j(
      'handed off — tell the user exactly what to do in the page, wait for them, then take the space back ONLY after they explicitly confirm (ego_space_takeover)',
    )} : ${j(
      'skipped: the space is not agent-owned right now; claim it first with ego_space_claim (with the user\'s consent)',
    )} }))\n`
  )
}

/** ego_space_takeover — take a user-owned space back. REQUIRES explicit user consent. */
export function buildSpaceTakeoverScript(target: string | number | null): string {
  const head = target === null ? SPACE_PICKER_FN : LIST_SPACES_HEAD
  const resolve = target === null ? '' : buildSpaceResolveSnippet(target)
  const call =
    target === null
      ? `var __r = await __op()\n`
      : `var __r = await __op(__target.id ?? __target.name)\n`
  return (
    head +
    resolve +
    pickLine('takeOverTaskSpace', 'takeOver') +
    call +
    `console.log('${SPACE_CONTROL_SENTINEL}' + JSON.stringify({ ok: true, space: __r, note: ${j(
      'space is agent-owned again; close it with ego_space_close when done',
    )} }))\n`
  )
}

/** ego_space_wait_control — read-only block until the agent regains control. */
export function buildSpaceWaitControlScript(
  target: string | number,
  timeoutMs: number,
  intervalMs: number,
): string {
  // Official helper speaks SECONDS (interval default 20, timeout default 600).
  const timeoutSec = Math.max(1, Math.round(timeoutMs / 1000))
  const intervalSec = Math.max(1, Math.round(intervalMs / 1000))
  return (
    SPACE_PICKER_FN +
    pickLine('waitForAgentControl', 'waitForAgentControl').replace(
      "typeof taskSpaces !== 'undefined' ? taskSpaces : null",
      'null',
    ) +
    `await __op(${j(target)}, { interval: ${intervalSec}, timeout: ${timeoutSec} })\n` +
    `console.log('${SPACE_CONTROL_SENTINEL}' + JSON.stringify({ ok: true, waitedSeconds: ${intervalSec}, note: ${j(
      'the agent has control of the space again',
    )} }))\n`
  )
}

/** Resolves a tab by targetId/id, url substring, title substring, or index. */
export const TAB_FIND_FN = `function __dshFindTab(tabs, t){
  var i, x
  for (i = 0; i < tabs.length; i++) { x = tabs[i]; if (String(x.targetId) === String(t) || String(x.id) === String(t)) return x }
  for (i = 0; i < tabs.length; i++) { x = tabs[i]; if ((x.url || '').indexOf(t) >= 0) return x }
  for (i = 0; i < tabs.length; i++) { x = tabs[i]; if ((x.title || '').indexOf(t) >= 0) return x }
  var n = Number(t)
  if (Number.isInteger(n) && n >= 0 && n < tabs.length) return tabs[n]
  return null
}
`

const LIST_TABS_HEAD =
  // __dshPick comes from SPACE_PICKER_FN: the tab bodies call it, so the
  // definition must ride along (regression-tested in space-control.test.ts).
  SPACE_PICKER_FN +
  TAB_FIND_FN +
  `var __tabs = await __dshPick(typeof listTabs === 'function' ? listTabs : null, typeof browser !== 'undefined' ? browser : null, 'listTabs')()\n`

/** ego_tab_list — every tab in the selected space with url/title/targetId. */
export function buildTabListScript(spacePre: string): string {
  return (
    spacePre +
    LIST_TABS_HEAD +
    `console.log('${SPACE_CONTROL_SENTINEL}' + JSON.stringify({ ok: true, count: __tabs.length, tabs: __tabs }))\n`
  )
}

/** ego_tab_switch — focus a tab matched by id/url-substring/title/index. */
export function buildTabSwitchScript(spacePre: string, target: string): string {
  return (
    spacePre +
    LIST_TABS_HEAD +
    `var __t = __dshFindTab(__tabs, ${j(target)})\n` +
    `if (!__t) throw new Error(${j(`no tab matching: ${target} — run ego_tab_list`)})\n` +
    `await __dshPick(typeof switchTab === 'function' ? switchTab : null, typeof browser !== 'undefined' ? browser : null, 'switchTab')(__t.targetId)\n` +
    `console.log('${SPACE_CONTROL_SENTINEL}' + JSON.stringify({ ok: true, switched: true, tab: __t }))\n`
  )
}

/** ego_tab_close — close a tab matched by id/url-substring/title/index. */
export function buildTabCloseScript(spacePre: string, target: string): string {
  return (
    spacePre +
    LIST_TABS_HEAD +
    `var __t = __dshFindTab(__tabs, ${j(target)})\n` +
    `if (!__t) throw new Error(${j(`no tab matching: ${target} — run ego_tab_list`)})\n` +
    `await __dshPick(typeof closeTab === 'function' ? closeTab : null, typeof browser !== 'undefined' ? browser : null, 'closeTab')(__t.targetId)\n` +
    `console.log('${SPACE_CONTROL_SENTINEL}' + JSON.stringify({ ok: true, closed: true, tab: __t, remaining: __tabs.length - 1 }))\n`
  )
}

/** Node-layer sleep injected by the scroll/wait builders. */
export const SLEEP_FN = `function __dshSleep(ms){ return new Promise(function(res){ setTimeout(res, Math.max(0, Number(ms) || 0)) }) }
`

/**
 * ego_scroll_to_bottom — infinite-scroll driver: pages down in viewport steps
 * until the page bottoms out or `selector` appears. Pure Node-layer loop over
 * synchronous page expressions, so it behaves identically on both flavors and
 * needs no scrollToBottomUntil signature guessing.
 */
export function buildScrollToBottomScript(
  spacePre: string,
  selector: string,
  maxScrolls: number,
  settleMs: number,
): string {
  const probe = selector
    ? `(!!document.querySelector(${j(selector)}))`
    : `false`
  return (
    spacePre +
    SLEEP_FN +
    `var __js = (typeof js === 'function') ? js : (typeof page !== 'undefined' && page && page.evaluate)\n` +
    `if (typeof __js !== 'function') throw new Error('[dsh-ego-lite] no js/page.evaluate helper on this engine')\n` +
    `var __found = false, __reached = false, __scrolls = 0, __y = 0, __max = 0\n` +
    `for (var __i = 0; __i < ${Math.max(1, Math.round(maxScrolls))}; __i++) {\n` +
    `  await __js('window.scrollBy(0, Math.max(200, Math.round(window.innerHeight * 0.9))); true')\n` +
    `  await __dshSleep(${Math.max(0, Math.round(settleMs))})\n` +
    `  var __st = await __js('(function(){var d=document.documentElement;return JSON.stringify({y:Math.round(window.scrollY),m:Math.round(d.scrollHeight - window.innerHeight),f:${probe}})})()')\n` +
    `  var __o = (typeof __st === 'string') ? JSON.parse(__st) : __st\n` +
    `  __y = Number(__o && __o.y) || 0\n` +
    `  __max = Number(__o && __o.m) || 0\n` +
    `  __found = !!(__o && __o.f)\n` +
    `  __scrolls = __i + 1\n` +
    `  if (__found || __y >= __max - 2) { __reached = __y >= __max - 2; break }\n` +
    `}\n` +
    `console.log('${SPACE_CONTROL_SENTINEL}' + JSON.stringify({ ok: true, scrollY: __y, maxScrollY: __max, reachedBottom: __reached, foundSelector: __found, scrolls: __scrolls }))\n`
  )
}

/**
 * ego_wait_page — deterministic wait for 'load' (document.readyState) or
 * 'networkidle' (readyState complete + resource-count stable for idleMs).
 * Self-implemented in the Node layer; no flat-wait signature guessing.
 */
export function buildWaitPageScript(
  spacePre: string,
  state: 'load' | 'networkidle',
  timeoutMs: number,
  idleMs: number,
): string {
  const wantIdle = state === 'networkidle'
  return (
    spacePre +
    SLEEP_FN +
    `var __js = (typeof js === 'function') ? js : (typeof page !== 'undefined' && page && page.evaluate)\n` +
    `if (typeof __js !== 'function') throw new Error('[dsh-ego-lite] no js/page.evaluate helper on this engine')\n` +
    `var __deadline = Date.now() + ${Math.max(0, Math.round(timeoutMs))}\n` +
    `var __idleNeeded = ${wantIdle ? Math.max(1, Math.round(idleMs)) : 0}\n` +
    `var __lastCount = -1, __stableSince = 0, __rs = '', __n = 0\n` +
    `for (;;) {\n` +
    `  var __st = await __js('(function(){return JSON.stringify({r:document.readyState,n:performance.getEntriesByType("resource").length})})()')\n` +
    `  var __o = (typeof __st === 'string') ? JSON.parse(__st) : __st\n` +
    `  __rs = String((__o && __o.r) || '')\n` +
    `  __n = Number((__o && __o.n) || 0)\n` +
    `  if (__rs === 'complete') {\n` +
    `    if (!${wantIdle}) break\n` +
    `    if (__n === __lastCount) { if (!__stableSince) __stableSince = Date.now(); if (Date.now() - __stableSince >= __idleNeeded) break }\n` +
    `    else { __lastCount = __n; __stableSince = Date.now() }\n` +
    `  } else { __lastCount = -1; __stableSince = 0 }\n` +
    `  if (Date.now() > __deadline) throw new Error(${j(
      `wait_page timed out after ${timeoutMs}ms waiting for '${state}' (last readyState: '`,
    )} + __rs + "')")\n` +
    `  await __dshSleep(250)\n` +
    `}\n` +
    `console.log('${SPACE_CONTROL_SENTINEL}' + JSON.stringify({ ok: true, state: ${j(state)}, readyState: __rs, resources: __n }))\n`
  )
}

/** Synthetic-keyCode table for common keys (W3C key values -> keyCode). */
export function keyCodeFor(key: string): number {
  const named: Record<string, number> = {
    Enter: 13, Tab: 9, Escape: 27, Esc: 27, Space: 32, Backspace: 8,
    Delete: 46, ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39,
    Home: 36, End: 35, PageUp: 33, PageDown: 34, Insert: 45,
  }
  if (named[key] !== undefined) return named[key]
  if (/^[a-zA-Z]$/.test(key)) return key.toUpperCase().charCodeAt(0)
  if (/^[0-9]$/.test(key)) return key.charCodeAt(0)
  return 0
}

/** W3C code value for common keys ('KeyA', 'Digit3', 'Enter', ...). */
export function keyCodeValueFor(key: string): string {
  if (/^[a-zA-Z]$/.test(key)) return 'Key' + key.toUpperCase()
  if (/^[0-9]$/.test(key)) return 'Digit' + key
  return key
}

/**
 * ego_dispatch_key — dispatch synthetic KeyboardEvent(s) at a selector or the
 * active element. Page-layer and deterministic on both flavors. Synthetic
 * events are isTrusted:false; real typing belongs to ego_key.
 */
export function buildDispatchKeyScript(
  spacePre: string,
  key: string,
  selector: string,
): string {
  const targetExpr = selector
    ? `document.querySelector(${j(selector)})`
    : `document.activeElement`
  const kc = keyCodeFor(key)
  const code = keyCodeValueFor(key)
  return (
    spacePre +
    `var __js = (typeof js === 'function') ? js : (typeof page !== 'undefined' && page && page.evaluate)\n` +
    `if (typeof __js !== 'function') throw new Error('[dsh-ego-lite] no js/page.evaluate helper on this engine')\n` +
    `var __r = await __js('(function(){var el=${targetExpr};if(!el)return{ok:false,reason:"no target element"};var init={key:${j(key)},code:${j(code)},keyCode:${kc},which:${kc},bubbles:true,cancelable:true};el.dispatchEvent(new KeyboardEvent("keydown",init));el.dispatchEvent(new KeyboardEvent("keyup",init));return{ok:true,key:init.key,code:init.code,target:(el.tagName||"").toLowerCase()}})()')\n` +
    `var __o = (typeof __r === 'string') ? JSON.parse(__r) : __r\n` +
    `console.log('${SPACE_CONTROL_SENTINEL}' + JSON.stringify({ ok: true, dispatched: __o, note: ${j(
      'synthetic event (isTrusted:false); for real keystrokes use ego_key',
    )} }))\n`
  )
}

/**
 * ego_site_tool — carrier for the official `learnings` site packs. The CLI
 * binds flat siteSkills(domains) / runSiteTool(site, tool, args); this is the
 * only surface the three official packs (google / github / x-com) need.
 */
export function buildSiteToolScript(
  site: string,
  tool: string,
  args: Record<string, unknown> | undefined,
): string {
  return (
    SPACE_PICKER_FN +
    `var __run = __dshPick(typeof runSiteTool === 'function' ? runSiteTool : null, typeof site !== 'undefined' ? site : null, 'runTool')\n` +
    `var __r = await __run(${j(site)}, ${j(tool)}, ${j(args ?? {})})\n` +
    `console.log('${SPACE_CONTROL_SENTINEL}' + JSON.stringify({ ok: true, site: ${j(site)}, tool: ${j(tool)}, result: __r }))\n`
  )
}
