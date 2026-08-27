/**
 * src/ai-search.ts — the web_ai_search / web_search_plain component.
 *
 * A small, focused Google AI Mode search layer built ON TOP of dsh-ego-lite.
 * It reuses the existing ego-browser plumbing (engine / mutex / sentinel /
 * runEgoScript) via registerActionTools in index.ts; this module only owns the
 * pure helpers and the in-browser scripts that:
 *
 *   1. build the `udm=50` Google AI Mode URL,
 *   2. wait for the asynchronously-streamed AI answer to finish rendering
 *      (the proxy: body length stabilises AND an "AI 模式对话" / "AI Mode"
 *      heading is present),
 *   3. extract the synthesised answer text AND the inline source citations
 *      (brand labels + `+N` markers / `/url?q=` hrefs), and
 *   4. assemble them into markdown with numbered `[1][2][3]` references.
 *
 * Design decisions (user-approved, see plan):
 *   - Returns 摘要 + 引用链接 together, not just the summary.
 *   - No `hl=en` / `gl` region fallback: search language follows the query
 *     content; the caller passes an array of queries to search multiple
 *     languages (e.g. "无职转生" → zh-CN + ja-JP).
 *   - Multi-space semantics from the official ego-browser skill: one task space
 *     per user goal, reused across calls, completed when the goal is done. The
 *     search reuses a dedicated 'web-search' space (or the caller's explicit
 *     `space`) instead of materialising an orphaned default.
 *   - Path A (coexist + guide): we ADD these tools on top of the big plugin; we
 *     do NOT remove the HTTP `web_search` tool.
 *
 * The exact DOM selectors for citations ARE the one unresolved implementation
 * item (pinned against a real AI Mode render during implementation). The
 * extractor below is deliberately multi-candidate and defensively falls back
 * to all decoded external links, so a selector shift degrades gracefully to
 * "fewer citations" rather than "no result".
 */

import { SENTINEL, j, str, num } from './util.ts'

/** Dedicated task space the search runs in when no explicit `space` is given. */
export const SEARCH_SPACE = 'web-search'

/** Max ms to wait for the AI answer to finish rendering per query. */
export const AI_SEARCH_TIMEOUT_MS = 40_000

/** Google AI Mode trigger: `udm=50` on google.com/search. */
export function buildAiSearchUrl(query: string, opts: { base?: string } = {}): string {
  const base = opts.base ?? 'https://www.google.com'
  return `${base}/search?q=${encodeURIComponent(query)}&udm=50`
}

export interface AiCitation {
  title: string
  url: string
}

/**
 * Assemble a search result into markdown with numbered references. Pure and
 * unit-testable; mirrors the in-page assembly. When there are citations the
 * summary and the reference list travel together (never summary-only).
 */
export function deriveSearchMarkdown(answer: string, sources: AiCitation[]): string {
  let md = answer ?? ''
  if (Array.isArray(sources) && sources.length > 0) {
    md += '\n\n'
    md += sources
      .map((s, i) => `[${i + 1}] ${s.title && s.title !== s.url ? `${s.title}: ` : ''}${s.url}`)
      .join('\n')
  }
  return md
}

/** In-page completion poll: returns { len, heading } without throwing. */
export const AI_POLL_FN = `function aiPoll() {
  const els = document.querySelectorAll('h1,h2,h3,div,span,a')
  let heading = null
  for (const e of els) {
    const t = (e.innerText || '').trim()
    if (/AI 模式对话|AI Mode/.test(t)) { heading = t.slice(0, 120); break }
  }
  return { len: document.body.innerText.length, heading }
}`

/** In-page consent acceptance: clicks an Agree/Accept-all button if present. */
export const AI_CONSENT_FN = `function aiConsent() {
  const labels = [/^I agree$/i, /^Accept all$/i, /^Agree$/i, /同意/i, /全部接受/i]
  for (const b of document.querySelectorAll('button, a[role="button"]')) {
    const t = (b.innerText || '').trim()
    if (t && labels.some(re => re.test(t))) { b.click(); return t }
  }
  return null
}`

/**
 * In-page extractor: grabs the AI answer heading, the surrounding answer text
 * (walk up to the largest textual container), and decoded external citation
 * links. Multi-candidate + defensive so a selector shift degrades gracefully.
 */
export const AI_EXTRACT_FN = `function aiExtract() {
  function normHref(h) {
    if (!h) return ''
    if (h.indexOf('/url?q=') === 0) {
      let rest = h.slice(7)
      const amp = rest.indexOf('&')
      if (amp >= 0) rest = rest.slice(0, amp)
      try { return decodeURIComponent(rest) } catch (e) { return rest }
    }
    if (h.indexOf('&url=') >= 0) {
      const parts = h.split('&url=')
      try { return decodeURIComponent(parts[1].split('&')[0]) } catch (e) { return parts[1].split('&')[0] }
    }
    return h
  }
  const els = document.querySelectorAll('h1,h2,h3,div,span,a')
  let heading = null, headingEl = null
  for (const e of els) {
    const t = (e.innerText || '').trim()
    if (/AI 模式对话|AI Mode/.test(t)) { heading = t.slice(0, 120); headingEl = e; break }
  }
  let answer = ''
  if (headingEl) {
    let best = headingEl, bestLen = 0, node = headingEl
    for (let up = 0; up < 6 && node; up++) {
      const len = (node.innerText || '').length
      if (len > bestLen && len < 14000) { bestLen = len; best = node }
      node = node.parentElement
    }
    answer = (best.innerText || '').trim()
  }
  if (!answer) answer = (document.body.innerText || '').trim().slice(0, 8000)
  const seen = {}
  const sources = []
  // Pinned citation DOM (live AI Mode render): each source is a card
  // span.WBgIic.Wg1cdb.notranslate containing an <a>.PMDqCb with the real URL,
  // plus the brand text and a "+N" count in span.OkUHJe. Extract brand (strip
  // the trailing "+N") + URL. Multi-candidate + defensive: if the pinned card
  // selector shifts, fall back to the inline brand/marker anchors, then to all
  // decoded external links — so it degrades to fewer citations, never none.
  let pinned = 0
  for (const c of document.querySelectorAll('span.WBgIic.Wg1cdb.notranslate')) {
    const a = c.querySelector('a[href]')
    if (!a) continue
    const href = normHref(a.getAttribute('href'))
    if (!href || !/^https?:\\/\\//.test(href) || seen[href]) continue
    seen[href] = 1
    let title = (c.innerText || '').trim()
    const m = title.match(/^([\\s\\S]*?)(?:\\s*\\+\\d+)?\\s*$/)
    if (m && m[1] && m[1].trim()) title = m[1].trim()
    sources.push({ title: title.slice(0, 60) || href, url: href })
    pinned++
  }
  if (pinned === 0) {
    const anchors = document.querySelectorAll('a[href]')
    for (const a of anchors) {
      const text = (a.innerText || '').trim()
      const href = normHref(a.getAttribute('href'))
      if (!href || !/^https?:\\/\\//.test(href)) continue
      const isMarker = /^(\\+\\d+|\\d+)$/.test(text)
      const isBrand = text.length > 0 && text.length <= 48 && /medium|dev\\.to|nextjs|workos|github|docs|blog|source|vercel|stackoverflow|reddit|wikipedia/iu.test(text)
      if (isMarker || isBrand) {
        if (!seen[href]) { seen[href] = 1; sources.push({ title: text || href, url: href }) }
      }
    }
  }
  return { ai: !!heading, heading, answer: answer.slice(0, 9000), sources: sources.slice(0, 25), bodyLen: document.body.innerText.length }
}`

/**
 * Build the runEgoScript body that drives one browser pass over the provided
 * AI Mode queries, waiting for each answer and extracting summary + citations.
 * `spaceArg`/`ensureRealTab` are the index.ts helpers (passed in to avoid a
 * circular import). The emitted payload carries `text` (markdown) so the shared
 * `renderText` surfaces it directly, plus `results` (structured) for tests.
 */
export function buildAiSearchScript(
  args: Record<string, unknown>,
  useSpace: (name: string) => string,
  ensureRealTab: () => string,
): string {
  const queries = (Array.isArray(args.queries) ? args.queries : []).filter(
    (q): q is string => typeof q === 'string' && q.trim() !== '',
  )
  const resolvedSpace = str(args.space, SEARCH_SPACE) as string
  if (queries.length === 0) {
    return `console.log('${SENTINEL}' + JSON.stringify({ ok: false, reason: 'web_ai_search: queries must be a non-empty array of strings' }))\n`
  }
  const maxWaitMs = num(args.maxWaitMs, AI_SEARCH_TIMEOUT_MS)
  const urls = queries.map((q) => buildAiSearchUrl(q))

  let s = ''
  s += useSpace(resolvedSpace)
  s += ensureRealTab()
  s += `const __queries = ${j(queries)}\n`
  s += `const __urls = ${j(urls)}\n`
  s += `const __results = []\n`
  s += `for (let __i = 0; __i < __urls.length; __i++) {\n`
  s += `  const __url = __urls[__i]\n`
  s += `  try {\n`
  s += `    await page.goto(__url, { wait: false, timeout: 20000 })\n`
  s += `    try { await page.evaluate("(" + ${j(AI_CONSENT_FN)} + ")()") } catch (__e) {}\n`
  s += `    let __state = null, __prev = -1, __stable = 0, __done = false\n`
  s += `    const __deadline = Date.now() + ${maxWaitMs}\n`
  s += `    while (Date.now() < __deadline) {\n`
  s += `      try { __state = await page.evaluate("(" + ${j(AI_POLL_FN)} + ")()") } catch (__e) { __state = null }\n`
  s += `      if (__state && __state.heading) __done = true\n`
  s += `      if (__state && __state.len === __prev) __stable++; else __stable = 0\n`
  s += `      __prev = __state ? __state.len : -1\n`
  s += `      if (__done && __stable >= 3) break\n`
  s += `      await page.waitForTimeout(500)\n`
  s += `    }\n`
  s += `    let __ext = null\n`
  s += `    try { __ext = await page.evaluate("(" + ${j(AI_EXTRACT_FN)} + ")()") } catch (__e) { __ext = null }\n`
  s += `    const __ok = !!__ext && !!__ext.ai\n`
  s += `    __results.push({ query: __queries[__i], ok: __ok, heading: __state ? __state.heading : null, answer: __ext ? __ext.answer : '', sources: __ext ? __ext.sources : [], bodyLen: __state ? __state.len : null, reason: __ok ? null : 'AI Mode did not render (consent/region/CAPTCHA) or answer+citations not detected' })\n`
  s += `  } catch (__e) {\n`
  s += `    __results.push({ query: __queries[__i], ok: false, error: String(__e) })\n`
  s += `  }\n`
  s += `}\n`
  // Assemble markdown for the shared renderText: summary + citations together.
  s += `const __text = __results.map(function (r) {\n`
  s += `  if (!r.ok) return '[搜索失败] ' + (r.query || '') + ': ' + (r.reason || r.error || '')\n`
  s += `  let md = r.answer || ''\n`
  s += `  if (r.sources && r.sources.length) { md += '\\n\\n' + r.sources.map(function (s, i) { return '[' + (i + 1) + '] ' + (s.title && s.title !== s.url ? s.title + ': ' : '') + s.url }).join('\\n') }\n`
  s += `  return '## ' + r.query + '\\n\\n' + md\n`
  s += `}).join('\\n\\n=====\\n\\n')\n`
  s += `console.log('${SENTINEL}' + JSON.stringify({ ok: true, results: __results, text: __text }))\n`
  return s
}

/** In-page extractor for plain (non-AI-Mode) Google result links. */
export const PLAIN_EXTRACT_FN = `function plainExtract() {
  function normHref(h) {
    if (!h) return ''
    if (h.indexOf('/url?q=') === 0) {
      let rest = h.slice(7)
      const amp = rest.indexOf('&')
      if (amp >= 0) rest = rest.slice(0, amp)
      try { return decodeURIComponent(rest) } catch (e) { return rest }
    }
    return h
  }
  const seen = {}
  const out = []
  for (const a of document.querySelectorAll('a[href]')) {
    const t = (a.innerText || '').trim()
    const href = normHref(a.getAttribute('href') || '')
    if (!t || t.length < 3 || !/^https?:\\/\\//.test(href)) continue
    if (/google\\.|gstatic|accounts\\.google/.test(href)) continue
    if (!seen[href]) { seen[href] = 1; out.push({ title: t.slice(0, 120), url: href.slice(0, 220) }) }
  }
  return { items: out.slice(0, 10) }
}`

/** Build the plain (no udm=50) Google result-links script. */
export function buildPlainSearchScript(
  args: Record<string, unknown>,
  useSpace: (name: string) => string,
  ensureRealTab: () => string,
): string {
  const queries = (Array.isArray(args.queries) ? args.queries : []).filter(
    (q): q is string => typeof q === 'string' && q.trim() !== '',
  )
  const resolvedSpace = str(args.space, SEARCH_SPACE) as string
  if (queries.length === 0) {
    return `console.log('${SENTINEL}' + JSON.stringify({ ok: false, reason: 'web_search_plain: queries must be a non-empty array of strings' }))\n`
  }
  const urls = queries.map((q) => `https://www.google.com/search?q=${encodeURIComponent(q)}`)

  let s = ''
  s += useSpace(resolvedSpace)
  s += ensureRealTab()
  s += `const __queries = ${j(queries)}\n`
  s += `const __urls = ${j(urls)}\n`
  s += `const __results = []\n`
  s += `for (let __i = 0; __i < __urls.length; __i++) {\n`
  s += `  const __url = __urls[__i]\n`
  s += `  try {\n`
  s += `    await page.goto(__url, { wait: true, timeout: 20000 })\n`
  s += `    try { await page.evaluate("(" + ${j(AI_CONSENT_FN)} + ")()") } catch (__e) {}\n`
  s += `    await page.waitForTimeout(400)\n`
  s += `    let __ext = null\n`
  s += `    try { __ext = await page.evaluate("(" + ${j(PLAIN_EXTRACT_FN)} + ")()") } catch (__e) { __ext = null }\n`
  s += `    const __items = __ext && __ext.items ? __ext.items : []\n`
  s += `    __results.push({ query: __queries[__i], ok: __items.length > 0, items: __items })\n`
  s += `  } catch (__e) {\n`
  s += `    __results.push({ query: __queries[__i], ok: false, error: String(__e) })\n`
  s += `  }\n`
  s += `}\n`
  s += `const __text = __results.map(function (r) {\n`
  s += `  if (!r.ok) return '[搜索失败] ' + (r.query || '') + ': ' + (r.error || 'no links found')\n`
  s += `  return '## ' + r.query + '\\n\\n' + r.items.map(function (it) { return '- ' + it.title + '\\n  ' + it.url }).join('\\n')\n`
  s += `}).join('\\n\\n=====\\n\\n')\n`
  s += `console.log('${SENTINEL}' + JSON.stringify({ ok: true, results: __results, text: __text }))\n`
  return s
}
