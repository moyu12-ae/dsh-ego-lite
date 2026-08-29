import z from 'schemastery'
import type { RawConfig, ResolvedConfig } from './types.ts'

// Defaults live in resolveConfig so a persisted legacy value is not hidden by
// a schema default before migration runs.
//
// Shared config interface — declared here (not in types.ts) so the composition
// entry (cordis.patch.yml) AND the settings namespace validate against the same
// field set. All fields are optional: the composition layer may omit any, and
// apply() falls back to the module defaults declared in index.ts below.
export interface Config {
  chromePath?: string
  egoCliArgs?: string
  chromeArgs?: string
  engineMode?: 'auto' | 'app' | 'vendored'
  execSession?: 'auto' | 'persistent' | 'per-call'
  /** Default task space for agents that omit `space`. */
  defaultSpace?: string | number
  /** Explicit ego-browser binary path; empty = auto-detect via resolveEngine. */
  egoBin?: string
  /** Cap on script stdout bytes collected before spilling to disk. */
  maxOutputBytes?: number
  /** Kill grace for spawns (ms). */
  graceMs?: number
  /** Default per-tool timeout (ms) for ego_* tools; a per-call override wins. */
  toolTimeoutMs?: number
}

export const Config = z.object({
  chromePath: z.string().description('Path to Chrome/Chromium. Empty = auto-detect. (vendored runtime only)'),
  // User-defined extra CLI args. Shell-like tokenize; mutually-exclusive
  // control flags are stripped (see EGO_CLI_BLOCKED / CHROME_BLOCKED below).
  egoCliArgs: z.string().description('Extra args appended to `ego-browser nodejs` argv. Takes effect on the next ego_* call.'),
  chromeArgs: z.string().description('Extra args appended to the Chrome launch argv (vendored runtime only). Takes effect on the next browser cold start (the browser is a singleton).'),
  engineMode: z.union(['auto', 'app', 'vendored']).description('CLI flavor: auto prefers the official ego lite app and falls back to the vendored runtime.'),
  execSession: z.union(['auto', 'persistent', 'per-call']).description('Execution channel for the official ego lite binary: auto/per-call spawn one `nodejs -e` eval per call (~0.4s full roundtrip, default); persistent OPTS INTO an experimental attached REPL session (requires a real TTY provider and is disabled by default).').default('auto'),
  // Plugin-level fields, now validated by the same schema. apply() still falls
  // back to the module defaults so a persisted legacy value is never hidden.
  defaultSpace: z.union([z.string(), z.number()]).description('Default task space for agents that omit `space`.'),
  egoBin: z.string().description('Explicit ego-browser binary path; empty = auto-detect via resolveEngine.'),
  maxOutputBytes: z.number().description('Cap on script stdout bytes collected before spilling to disk.'),
  graceMs: z.number().description('Kill grace for spawns (ms).'),
  toolTimeoutMs: z.number().description('Default per-tool timeout (ms) for ego_* tools; a per-call override wins.'),
})

// ── user-defined extra CLI args ─────────────────────────────────────────────
/**
 * Flags the user must NOT put in `egoCliArgs`: these ego-browser subcommands
 * exit before the heredoc runs (--status/--stop/--help/...) or steal the
 * browser window (--open), so appending them would break every ego_* tool.
 * `--headless` is managed by EGO_LINUX_HEADLESS; `--sdk-path` is allowed.
 */
export const EGO_CLI_BLOCKED = new Set<string>([
  '--status',
  '--stop',
  '--open',
  '--spaces',
  '--spaces-daemon',
  '--prune-spaces',
  '--import-chrome-profile',
  '--install-desktop-entry',
  '--help',
  '-h',
])

/**
 * Flags the user must NOT put in `chromeArgs`: these are managed by the
 * launcher / EGO_LINUX_PROXY and overriding them would break CDP control,
 * profile isolation, or the proxy bypass list. `--proxy-server` should go
 * through EGO_LINUX_PROXY (which also sets the bypass list).
 */
export const CHROME_BLOCKED = new Set<string>([
  '--user-data-dir',
  '--remote-debugging-port',
  '--remote-allow-origins',
  '--headless',
  '--no-startup-window',
  '--proxy-server',
  '--proxy-bypass-list',
])

/**
 * Shell-like tokenizer for user-supplied arg strings. Handles single/double
 * quotes and backslash escapes; bare whitespace separates tokens. Returns []
 * for empty/whitespace-only input. Used for both `egoCliArgs` and `chromeArgs`
 * (mirrored in runtime/ego-linux/src/chrome.mjs for the Chrome side, since the
 * runtime must not import from src/).
 */
export function tokenizeArgs(input: unknown): string[] {
  if (typeof input !== 'string') return []
  const out: string[] = []
  let cur = ''
  let i = 0
  let quote: string | null = null
  while (i < input.length) {
    const c = input[i]!
    if (quote) {
      if (c === '\\') {
        const next = input[i + 1]
        if (next !== undefined) {
          cur += next
          i += 2
          continue
        }
      } else if (c === quote) {
        quote = null
        i += 1
        continue
      }
      cur += c
      i += 1
      continue
    }
    if (c === '"' || c === "'") {
      quote = c
      i += 1
      continue
    }
    if (c === '\\') {
      const next = input[i + 1]
      if (next !== undefined) {
        cur += next
        i += 2
        continue
      }
      i += 1
      continue
    }
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      if (cur !== '') {
        out.push(cur)
        cur = ''
      }
      i += 1
      continue
    }
    cur += c
    i += 1
  }
  if (cur !== '') out.push(cur)
  return out
}

/**
 * Split a raw arg string into tokens, dropping any token (and, for `--flag
 * value` pairs, its value) that appears in `blocked`. A "blocked" token with a
 * `=` attached (e.g. `--headless=new`) is also dropped. Returns the surviving
 * tokens. Exposed for tests and for the runtime to mirror.
 */
export function filterArgs(raw: string, blocked: Set<string>): string[] {
  const tokens = tokenizeArgs(raw)
  const kept: string[] = []
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]!
    const key = tok.includes('=') ? tok.slice(0, tok.indexOf('=')) : tok
    if (blocked.has(key)) {
      // Drop a bare `--flag value` pair when the flag is blocklisted and the
      // next token does not itself look like a flag (i.e. it is the value).
      if (!tok.includes('=') && i + 1 < tokens.length && !tokens[i + 1]!.startsWith('-')) {
        i += 1
      }
      continue
    }
    kept.push(tok)
  }
  return kept
}

function oneOf<T extends string>(value: unknown, values: readonly T[], fallback: T): T {
  return typeof value === 'string' && (values as readonly string[]).includes(value) ? (value as T) : fallback
}

export function resolveConfig(config: RawConfig = {}): ResolvedConfig {
  return {
    chromePath: typeof config.chromePath === 'string' ? config.chromePath : '',
    // User-defined extra args: stored raw (string), filtered at the call site
    // so a saved value is not silently mutated by a later blocklist change.
    egoCliArgs: typeof config.egoCliArgs === 'string' ? config.egoCliArgs : '',
    chromeArgs: typeof config.chromeArgs === 'string' ? config.chromeArgs : '',
    engineMode: oneOf(config.engineMode, ['auto', 'app', 'vendored'] as const, 'auto'),
    execSession: oneOf(config.execSession, ['auto', 'persistent', 'per-call'] as const, 'auto'),
  }
}
