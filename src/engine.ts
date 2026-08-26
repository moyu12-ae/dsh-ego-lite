/**
 * engine — runtime flavor resolution for the ego-browser CLI.
 *
 * Two flavors can execute the same facade scripts:
 *  - `app`      : the OFFICIAL ego lite desktop app's native `ego-browser`
 *                 helper (macOS). It talks to the running app; the plugin never
 *                 launches its own browser. Preferred whenever present.
 *  - `vendored` : this repo's runtime/ego-linux/bin/ego-browser.mjs shim
 *                 driving its own Chromium over CDP (Linux/Windows/ci, or any
 *                 host without the app installed). Needs a JS interpreter
 *                 prefix to spawn.
 *
 * Detection order (cheapest first, explicit override always wins):
 *  1. `EGO_EGO_BIN` config value, when it points at an existing file.
 *  2. ~/.local/bin/ego-browser            (app onboarding symlink)
 *  3. <apps>/ego lite.app/.../Helpers/ego-browser   (framework Current, then
 *     highest version dir as a fallback for unusual installs)
 *  4. vendored default.
 */

import { existsSync, readdirSync } from 'node:fs'
import { homedir, platform } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export type EngineFlavor = 'app' | 'vendored'

export interface ResolvedEngine {
  flavor: EngineFlavor
  /** Executable to spawn. For `jsRuntime` flavors this is a JS entry module. */
  binPath: string
  /** True when binPath is plain JS and needs [node] prefix to run. */
  jsRuntime: boolean
  /** Short human-readable provenance for doctor/status output. */
  origin: string
}

/** Vendored CLI shipped inside this plugin (runtime/ego-linux/bin/). */
export const VENDORED_EGO_BIN = fileURLToPath(
  new URL('../runtime/ego-linux/bin/ego-browser.mjs', import.meta.url),
)

const APP_BUNDLE = 'ego lite.app'

/** macOS app-search roots; resolved lazily so tests can inject a fake home. */
function appDirs(home: string): string[] {
  return ['/Applications', join(home, 'Applications')]
}

function looksLikeJsModule(binPath: string): boolean {
  return /\.mjs$|\.cjs$|\.js$/i.test(binPath)
}

function findFrameworkHelper(bundleDir: string, io: EngineIo): string | null {
  const frameworksDir = join(bundleDir, 'Contents', 'Frameworks')
  let frameworks: string[]
  try {
    frameworks = io.list(frameworksDir)
  } catch {
    return null
  }
  // Prefer the "Current" symlink the updater maintains.
  for (const fw of frameworks) {
    const candidate = join(
      frameworksDir, fw, 'Versions', 'Current', 'Helpers', 'ego-browser',
    )
    if (io.exists(candidate)) return candidate
  }
  // Fall back to the highest version directory containing a helper.
  let best: { version: string; path: string } | null = null
  for (const fw of frameworks) {
    const versionsDir = join(frameworksDir, fw, 'Versions')
    let versions: string[]
    try {
      versions = io.list(versionsDir)
    } catch {
      continue
    }
    for (const version of versions) {
      if (!/^\d+(\.\d+)*$/.test(version)) continue
      const candidate = join(versionsDir, version, 'Helpers', 'ego-browser')
      if (!io.exists(candidate)) continue
      // Numeric segment-wise comparison: a stringified-array compare would
      // rank "0.4.7.2" above "0.4.7.10".
      const rank = version.split('.').map((n) => Number.parseInt(n, 10) || 0)
      if (
        best === null ||
        ranksGreater(rank, best.version.split('.').map((n) => Number.parseInt(n, 10) || 0))
      ) best = { version, path: candidate }
    }
  }
  return best?.path ?? null
}

function ranksGreater(a: number[], b: number[]): boolean {
  const len = Math.max(a.length, b.length)
  for (let i = 0; i < len; i++) {
    const av = a[i] ?? 0
    const bv = b[i] ?? 0
    if (av !== bv) return av > bv
  }
  return false
}

/** Filesystem surface used for probing — injectable so tests need no mocks. */
export interface EngineIo {
  exists(path: string): boolean
  /** List a directory; must THROW for missing/inaccessible directories. */
  list(path: string): string[]
}

const nodeFsIo: EngineIo = {
  exists: (path) => existsSync(path),
  list: (path) => readdirSync(path),
}

export interface ResolveEngineOptions {
  /** User/explicitly configured binary path; highest priority when it exists. */
  configuredEgoBin?: string
  /** One of 'auto' | 'app' | 'vendored'. */
  engineMode?: string
  /** Injectable for tests; defaults to node:os homedir(). */
  home?: string
  /** Injectable for tests; defaults to node:os platform(). */
  platform?: string
  /** Injectable filesystem probes; defaults to the real node:fs. */
  io?: EngineIo
}

export function resolveEngine(opts: ResolveEngineOptions = {}): ResolvedEngine {
  const home = opts.home ?? homedir()
  const plat = opts.platform ?? platform()
  const io = opts.io ?? nodeFsIo
  const mode = opts.engineMode === 'app' || opts.engineMode === 'vendored' ? opts.engineMode : 'auto'

  // Explicit path configured → trust it blindly (power-user escape hatch).
  const configured =
    typeof opts.configuredEgoBin === 'string' && opts.configuredEgoBin.trim() !== ''
      ? opts.configuredEgoBin.trim()
      : ''
  if (configured !== '' && io.exists(configured)) {
    const jsRuntime = looksLikeJsModule(configured)
    return {
      flavor: configured.includes('ego-linux') || jsRuntime ? 'vendored' : 'app',
      binPath: configured,
      jsRuntime,
      origin: 'configured',
    }
  }

  if (mode !== 'vendored') {
    const candidates: Array<{ path: string; origin: string }> = []
    if (plat === 'darwin') {
      candidates.push({ path: join(home, '.local', 'bin', 'ego-browser'), origin: '~/.local/bin (app symlink)' })
      for (const base of appDirs(home)) {
        candidates.push({
          path: findFrameworkHelper(join(base, APP_BUNDLE), io) ?? '',
          origin: `${base}/${APP_BUNDLE}`,
        })
      }
    }
    for (const candidate of candidates) {
      if (candidate.path !== '' && io.exists(candidate.path)) {
        return { flavor: 'app', binPath: candidate.path, jsRuntime: false, origin: candidate.origin }
      }
    }
  }

  return { flavor: 'vendored', binPath: VENDORED_EGO_BIN, jsRuntime: true, origin: 'vendored runtime/ego-linux' }
}

/** Full spawn argv for one heredoc-style invocation. */
export function buildSpawnArgv(engine: ResolvedEngine, extraCliArgs: readonly string[], nodeExecPath: string): string[] {
  const prefix = engine.jsRuntime ? [nodeExecPath] : []
  return [...prefix, engine.binPath, 'nodejs', ...extraCliArgs]
}

const EGO_LINUX_ENV_KEYS = [
  'EGO_LINUX_CHROME',
  'EGO_LINUX_HEADLESS',
  'EGO_LINUX_EXTRA_ARGS',
  'EGO_LINUX_PROXY',
] as const

/**
 * Env for one invocation. The vendored flavor gets the full auto-adapted env
 * (chrome discovery/headless/proxy bridging); the app flavor deliberately gets
 * NONE of those keys — the user's running app owns its browser, and leaking
 * Linux-shim hints at the official binary could only confuse it.
 */
export function engineEnv(engine: ResolvedEngine, vendoredEnv: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  if (engine.flavor === 'vendored') return vendoredEnv
  const env: NodeJS.ProcessEnv = { ...vendoredEnv }
  for (const key of EGO_LINUX_ENV_KEYS) delete env[key]
  return env
}
