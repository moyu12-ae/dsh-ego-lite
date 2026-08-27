import { describe, it, expect } from 'vitest'
import {
  SEARCH_SPACE,
  AI_SEARCH_TIMEOUT_MS,
  buildAiSearchUrl,
  deriveSearchMarkdown,
  buildAiSearchScript,
  buildPlainSearchScript,
  AI_POLL_FN,
  AI_CONSENT_FN,
  AI_EXTRACT_FN,
  PLAIN_EXTRACT_FN,
} from '../src/ai-search.ts'

const useSpace = (name: string): string => `const task = await taskSpaces.useOrCreate(${JSON.stringify(name)})\n`
const ensureRealTab = (): string => `const __tabs = await browser.listTabs()\n`

describe('ai-search url builder', () => {
  it('builds the udm=50 AI Mode URL and percent-encodes the query', () => {
    expect(buildAiSearchUrl('Next.js 15 App Router best practices 2026')).toBe(
      'https://www.google.com/search?q=Next.js%2015%20App%20Router%20best%20practices%202026&udm=50',
    )
  })
  it('allows a custom base and keeps the udm=50 trigger', () => {
    expect(buildAiSearchUrl('hi', { base: 'https://www.google.com.hk' })).toBe(
      'https://www.google.com.hk/search?q=hi&udm=50',
    )
  })
  it('encodes CJK and non-ASCII query content (language follows content)', () => {
    expect(buildAiSearchUrl('無職転生 アニメ')).toBe(
      'https://www.google.com/search?q=%E7%84%A1%E8%81%B7%E8%BB%A2%E7%94%9F%20%E3%82%A2%E3%83%8B%E3%83%A1&udm=50',
    )
  })
})

describe('ai-search markdown (summary + citations together)', () => {
  it('keeps summary plus numbered citations together, never summary-only', () => {
    const md = deriveSearchMarkdown(
      'Answer body here.',
      [
        { title: 'Medium · Hashbyt', url: 'https://medium.com/a' },
        { title: 'https://nextjs.org/blog', url: 'https://nextjs.org/blog' },
      ],
    )
    expect(md).toContain('Answer body here.')
    expect(md).toContain('[1] Medium · Hashbyt: https://medium.com/a')
    expect(md).toContain('[2] https://nextjs.org/blog')
  })
  it('omits the reference block when there are no sources', () => {
    expect(deriveSearchMarkdown('Only a summary.', [])).toBe('Only a summary.')
  })
  it('collapses a source whose title equals its URL (avoids repeating it)', () => {
    expect(deriveSearchMarkdown('x', [{ title: 'https://a.com', url: 'https://a.com' }])).toBe(
      'x\n\n[1] https://a.com',
    )
  })
})

describe('ai-search in-page script strings parse as valid functions', () => {
  for (const [name, src] of [
    ['AI_POLL_FN', AI_POLL_FN],
    ['AI_CONSENT_FN', AI_CONSENT_FN],
    ['AI_EXTRACT_FN', AI_EXTRACT_FN],
    ['PLAIN_EXTRACT_FN', PLAIN_EXTRACT_FN],
  ] as const) {
    it(`${name} is a valid JS function body`, () => {
      expect(() => new Function(`return (${src})`)).not.toThrow()
    })
  }
})

describe('ai-search extractor strips the "+N" citation count from multiline brand titles', () => {
  // Regression guard for the live bug: the brand text is multi-line
  // ("Medium\n·Hashbyt | …\n +2"), so the extractor's title regex must span
  // newlines (a bare "." never matches \n) or "^".."$" can't capture and the
  // trailing "+N" leaks into the returned title.
  const runExtract = (cardInnerText: string): string => {
    // Minimal document stub exposing only what aiExtract uses: the pinned card
    // with an inner <a>, plus a document.body.innerText fallback.
    const card = {
      innerText: cardInnerText,
      querySelector: (): { getAttribute: (k: string) => string } => ({
        getAttribute: (): string => 'https://medium.com/really-decoded-url',
      }),
    }
    const doc = {
      querySelectorAll: (sel: string): unknown[] => (sel.startsWith('span.WBgIic') ? [card] : []),
      body: { innerText: 'AI 模式对话：Next.js 15 App Router best practices 2026' },
    }
    // aiExtract() runs as a bare function in the page and is the only free var it
    // reads (`document`). Bind it so the stub drives the title extraction.
    const extract = new Function('document', `return (${AI_EXTRACT_FN})()`)
    const out = extract(doc)
    return (out.sources[0]?.title as string) || ''
  }

  it('strips the trailing +N when the brand is multi-line', () => {
    const title = runExtract('Medium\n·Hashbyt | AI-First Frontend & UI/UX SaaS Partner\n +2')
    expect(title).toBe('Medium\n·Hashbyt | AI-First Frontend & UI/UX SaaS Partner')
  })

  it('preserves a brand that has no trailing +N', () => {
    const title = runExtract('Medium\n·Suresh Kumar Ariya Gowder\n +1')
    expect(title).toBe('Medium\n·Suresh Kumar Ariya Gowder')
  })
})

describe('buildAiSearchScript', () => {
  it('emits an actionable failure for an empty queries array', () => {
    const script = buildAiSearchScript({ queries: [] }, useSpace, ensureRealTab)
    expect(script).toContain('@@DSH_RESULT@@')
    expect(script).toContain('queries must be a non-empty array of strings')
    expect(script).toContain('ok: false')
  })
  it('uses the dedicated web-search space by default and page.goto each query', () => {
    const script = buildAiSearchScript({ queries: ['q1', 'q2'] }, useSpace, ensureRealTab)
    expect(script).toContain(`useOrCreate("${SEARCH_SPACE}")`)
    expect(script).toContain('udm=50')
    // encoded urls for both queries
    expect(script).toContain('q1&udm=50')
    expect(script).toContain('q2&udm=50')
    // completion wait poll + consent + extractor are wired in
    expect(script).toContain('AI 模式对话')
    expect(script).toContain('page.goto')
    expect(script).toContain('page.waitForTimeout')
    // markdown assembly (summary + citations together) present
    expect(script).toContain('r.answer')
    expect(script).toContain('r.sources')
  })
  it('honors an explicit space and a maxWaitMs override', () => {
    const script = buildAiSearchScript({ queries: ['x'], space: 'my-goal', maxWaitMs: 5000 }, useSpace, ensureRealTab)
    expect(script).toContain('useOrCreate("my-goal")')
    expect(script).toContain('Date.now() + 5000')
  })
})

describe('buildPlainSearchScript', () => {
  it('builds plain (no udm=50) result-links urls and extracts items', () => {
    const script = buildPlainSearchScript({ queries: ['hello world'] }, useSpace, ensureRealTab)
    expect(script).toContain('useOrCreate("web-search")')
    expect(script).not.toContain('udm=50')
    expect(script).toContain('q=hello%20world')
    expect(script).toContain('plainExtract')
  })
  it('fails cleanly on empty queries', () => {
    const script = buildPlainSearchScript({ queries: [] }, useSpace, ensureRealTab)
    expect(script).toContain('queries must be a non-empty array of strings')
  })
})

describe('constants', () => {
  it('defaults the search space and timeout as designed', () => {
    expect(SEARCH_SPACE).toBe('web-search')
    expect(AI_SEARCH_TIMEOUT_MS).toBe(40_000)
  })
})
