/**
 * ego-browser build: one artifact.
 *   host — src/index.ts bundled to lib/index.js (Node ESM). Peers
 *   (dsh-tools / dsh-settings / cordis) are external; the Schemastery Config
 *   schema is bundled in (self-contained).
 *
 * Historical note: v0.8.x also shipped lib/client.js (watch-panel frontend)
 * and bin/ego-cast-worker.mjs (screencast worker). Both were removed when the
 * plugin dropped its realtime preview stack in favor of driving the official
 * ego lite app directly — see CHANGELOG [Unreleased].
 */
import { defineConfig, type UserConfig } from 'tsdown'

const ID = 'dsh-ego-lite'

/** Host-provided singletons: never bundle, keep as runtime imports. */
const HOST_EXTERNALS = [
  '@deepseek-ai/dsh-tools',
  '@deepseek-ai/dsh-tools/invariant',
  '@deepseek-ai/dsh-settings',
  '@deepseek-ai/cordis',
]

const host: UserConfig = {
  name: ID,
  entry: { index: 'src/index.ts' },
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  dts: false,
  clean: true,
  external: HOST_EXTERNALS,
}

export default defineConfig(host)
