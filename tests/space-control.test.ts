import { describe, it, expect } from 'vitest'
import {
  SPACE_CONTROL_SENTINEL,
  SPACE_PICKER_FN,
  buildSpaceResolveSnippet,
  buildSpaceListScript,
  buildSpaceClaimScript,
  buildSpaceHandoffScript,
  buildSpaceTakeoverScript,
  buildSpaceWaitControlScript,
  buildTabListScript,
  buildTabSwitchScript,
  buildTabCloseScript,
  buildScrollToBottomScript,
  buildWaitPageScript,
  buildDispatchKeyScript,
  buildSiteToolScript,
  keyCodeFor,
  keyCodeValueFor,
} from '../src/space-control.ts'

const OUT = (script: string): string =>
  script.includes(SPACE_CONTROL_SENTINEL) ? 'sentinel-present' : 'sentinel-missing'

describe('space-control: picker + resolve', () => {
  it('picker prefers flat helpers before namespace members', () => {
    expect(SPACE_PICKER_FN.indexOf("typeof flat === 'function'")).toBeGreaterThan(-1)
    expect(SPACE_PICKER_FN.indexOf('nsObj[nsKey]')).toBeGreaterThan(-1)
    expect(SPACE_PICKER_FN.indexOf('typeof flat ===')).toBeLessThan(
      SPACE_PICKER_FN.indexOf('nsObj[nsKey]'),
    )
  })

  it('resolve never creates: finds by id or name, throws with ego_space_list hint', () => {
    const snip = buildSpaceResolveSnippet('my-goal')
    expect(snip).toContain('__spaces.find')
    expect(snip).toContain('String(s.id) === String("my-goal")')
    expect(snip).toContain('String(s.name) === String("my-goal")')
    expect(snip).toContain('task space not found: my-goal')
    expect(snip).toContain('ego_space_list')
    expect(snip).not.toContain('useOrCreate')
  })
})

describe('space-control: handoff family scripts', () => {
  it('list emits spaces with count', () => {
    const s = buildSpaceListScript()
    expect(s).toContain('listTaskSpaces')
    expect(s).toContain('count: __spaces.length')
    expect(OUT(s)).toBe('sentinel-present')
  })

  it('claim resolves the target then claims via id??name', () => {
    const s = buildSpaceClaimScript(42)
    expect(s).toContain(buildSpaceResolveSnippet(42))
    expect(s).toContain('claimTaskSpace')
    expect(s).toContain('__op(__target.id ?? __target.name)')
    expect(s).toContain('ownership transferred')
    expect(OUT(s)).toBe('sentinel-present')
  })

  it('handoff with target resolves; without target calls flat with no args', () => {
    const withTarget = buildSpaceHandoffScript('dsh-agent')
    expect(withTarget).toContain('__op(__target.id ?? __target.name)')
    expect(withTarget).toContain('handOffTaskSpace')
    expect(withTarget).toContain('__r.done !== false && !__r.skipped')
    expect(withTarget).toContain('skipped: the space is not agent-owned')

    const noTarget = buildSpaceHandoffScript(null)
    expect(noTarget).toContain('var __r = await __op()')
    expect(noTarget).not.toContain('__target')
    // the generated ternary must be syntactically complete
    expect(noTarget).toContain('note: __done ? "')
    expect(noTarget).toContain('" : "')
  })

  it('takeover reports the space is agent-owned again', () => {
    const s = buildSpaceTakeoverScript('x')
    expect(s).toContain('takeOverTaskSpace')
    expect(s).toContain('agent-owned again')
    expect(OUT(s)).toBe('sentinel-present')
  })

  it('wait_control converts ms to the helper SECONDS contract', () => {
    const s = buildSpaceWaitControlScript('space-a', 60000, 2000)
    expect(s).toContain('waitForAgentControl')
    expect(s).toContain('{ interval: 2, timeout: 60 }')
    expect(s).toContain('"space-a"')
  })
})

describe('space-control: tab tools', () => {
  it('tab list resolves via flat listTabs or browser.listTabs', () => {
    const s = buildTabListScript('const __pre = 1\n')
    expect(s.startsWith('const __pre = 1\n')).toBe(true)
    expect(s).toContain("typeof listTabs === 'function'")
    expect(s).toContain("'listTabs')")
  })

  it('tab scripts DEFINE __dshPick before calling it (no ReferenceError)', () => {
    // Regression: tab bodies call __dshPick but LIST_TABS_HEAD only carried
    // TAB_FIND_FN — the picker definition (SPACE_PICKER_FN) was missing, so
    // every tab tool died with "ReferenceError: __dshPick is not defined".
    for (const s of [
      buildTabListScript(''),
      buildTabSwitchScript('', 'example.com'),
      buildTabCloseScript('', 'example.com'),
    ]) {
      const defIdx = s.indexOf('function __dshPick')
      const useIdx = s.indexOf('__dshPick(')
      expect(defIdx).toBeGreaterThanOrEqual(0)
      expect(useIdx).toBeGreaterThan(defIdx)
    }
  })

  it('tab switch/close find by targetId/url/title/index and pass targetId', () => {
    for (const s of [buildTabSwitchScript('', 'https://x'), buildTabCloseScript('', 'docs')]) {
      expect(s).toContain('__dshFindTab(__tabs, ')
      expect(s).toContain('String(x.targetId) === String(t)')
      expect(s).toContain("(x.url || '').indexOf(t) >= 0")
      expect(s).toContain("(x.title || '').indexOf(t) >= 0")
      expect(s).toContain('__t.targetId')
    }
  })
})

describe('space-control: scroll / wait / dispatch / site tools', () => {
  it('scroll loop stops on selector or bottom and reports both', () => {
    const s = buildScrollToBottomScript('', '.item', 12, 400)
    expect(s).toContain('window.scrollBy(0, Math.max(200, Math.round(window.innerHeight * 0.9))); true')
    expect(s).toContain('!!document.querySelector(".item")')
    expect(s).toContain('__i < 12')
    expect(s).toContain('foundSelector: __found')
    expect(s).toContain('reachedBottom: __reached')
  })

  it('scroll without selector never probes the DOM for one', () => {
    const s = buildScrollToBottomScript('', '', 5, 300)
    expect(s).toContain('f:false')
  })

  it('wait_page load polls readyState only; networkidle adds stability window', () => {
    const load = buildWaitPageScript('', 'load', 8000, 500)
    expect(load).toContain("document.readyState")
    expect(load).toContain('__idleNeeded = 0')

    const idle = buildWaitPageScript('', 'networkidle', 8000, 700)
    expect(idle).toContain('__idleNeeded = 700')
    expect(idle).toContain('performance.getEntriesByType("resource").length')
  })

  it('dispatch key maps named keys and injects target expression', () => {
    const s = buildDispatchKeyScript('', 'Enter', '#search')
    expect(s).toContain('document.querySelector("#search")')
    expect(s).toContain('key:"Enter"')
    expect(s).toContain('code:"Enter"')
    expect(s).toContain('keyCode:13')

    const active = buildDispatchKeyScript('', 'a', '')
    expect(active).toContain('document.activeElement')
    expect(active).toContain('code:"KeyA"')
    expect(active).toContain('keyCode:65')
  })

  it('site tool passes site/tool/args positionally to runSiteTool', () => {
    const s = buildSiteToolScript('google', 'search_and_extract', { query: 'hi' })
    expect(s).toContain('"google"')
    expect(s).toContain('"search_and_extract"')
    expect(s).toContain('{"query":"hi"}')
    expect(s).toContain("typeof runSiteTool === 'function'")
  })
})

describe('space-control: key tables', () => {
  it('maps named, alpha and digit keys', () => {
    expect(keyCodeFor('Enter')).toBe(13)
    expect(keyCodeFor('Escape')).toBe(27)
    expect(keyCodeFor('ArrowDown')).toBe(40)
    expect(keyCodeFor('a')).toBe(65)
    expect(keyCodeFor('5')).toBe(53)
    expect(keyCodeValueFor('a')).toBe('KeyA')
    expect(keyCodeValueFor('5')).toBe('Digit5')
    expect(keyCodeValueFor('Enter')).toBe('Enter')
  })
})
