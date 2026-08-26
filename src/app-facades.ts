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
`

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
`

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

G.__DSH_APP_COMPAT__ = true
})();
`

export const APP_FACADE_PRELUDE: string = HEAD + LOCATOR + PAGE

/** Wrap a builder-produced script with the app-flavor compat prelude. */
export function withAppFacades(engineFlavor: 'app' | 'vendored', script: string): string {
  return engineFlavor === 'app' ? APP_FACADE_PRELUDE + '\n' + script : script
}
