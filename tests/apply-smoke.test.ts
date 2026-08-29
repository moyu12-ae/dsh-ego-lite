import { describe, it, expect } from 'vitest'
import { apply } from '../src/index.ts'

/**
 * Registration smoke test — catches schema-level rejections (defineTool's
 * compiler throws at REGISTRATION time, e.g. "parameters.args
 * .additionalProperties must be explicitly true or false" for the
 * ego_site_tool free-form args object) that buildScript unit tests never
 * touch, because they exercise the builders directly instead of reg().
 *
 * Regression for v0.9.3: one bad parameter schema made the whole plugin
 * fiber fail on load while `node import lib/index.js` stayed green.
 */
describe('apply() registration smoke', () => {
  it('registers every tool without schema rejections', () => {
    const registered: string[] = []
    const ctx = {
      logger: { info: () => {}, warn: () => {}, error: () => {} },
      effect: () => () => {},
      tools: {
        register(tool: { name?: string }) {
          registered.push(String(tool?.name))
          return () => {}
        },
      },
    }
    expect(() => apply(ctx as never, {})).not.toThrow()
    // 32 legacy ego_* tools + web_ai_search/web_search_plain + the 12
    // v0.9.3 full-parity tools (space control x5, tabs x3, scroll/wait/
    // dispatch/site-tool) + status/auth-flush/help/doctor families.
    expect(registered.length).toBeGreaterThanOrEqual(46)
    for (const name of [
      'ego_space_list',
      'ego_space_claim',
      'ego_space_handoff',
      'ego_space_takeover',
      'ego_space_wait_control',
      'ego_tab_list',
      'ego_tab_switch',
      'ego_tab_close',
      'ego_scroll_to_bottom',
      'ego_wait_page',
      'ego_dispatch_key',
      'ego_site_tool',
    ]) {
      expect(registered, `missing tool ${name}`).toContain(name)
    }
  })
})
