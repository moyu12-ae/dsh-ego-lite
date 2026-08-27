/**
 * repl-session — persistent executor driving the OFFICIAL `ego-browser nodejs`
 * REPL over a pseudo-TTY.
 *
 * Why: every heredoc-style call pays process boot + app attach. The official
 * helper bundles an interactive REPL ("With TTY stdin and no source script,
 * ego-browser starts an interactive REPL") which keeps ONE attached runtime
 * alive across scripts — same connection, session state, and task-space
 * selection. Driving it with `/usr/bin/script -q` gives us the TTY stdin it
 * needs while we speak a tiny frame protocol on the pipes.
 *
 * Protocol facts (probed against ego lite 0.4.7.3):
 *  - Banner on start: "ego-browser nodejs REPL. Type .exit to quit, ..."
 *  - Prompt token between inputs: `repl> `
 *  - Multiline input: `.cell` … `.end` (`.cancel` discards). NOT valid inside
 *    piped heredocs — this module is precisely the TTY side of that rule.
 *  - Errors hard-stop silently (output buffer dropped). Therefore EVERY cell
 *    is responsible for its own completion signal: tool scripts already end
 *    with the @@DSH_RESULT@@ sentinel line, and the transport wraps the whole
 *    cell in try/catch so even a thrown cell emits an error sentinel.
 *  - The pty ECHOES our input lines back. A naive sentinel scan could match an
 *    echoed `'@@DSH_RESULT@@'` source fragment, so written cells have the
 *    literal split into adjacent string parts (`'@@DSH_RE'+'SULT@@'`), which
 *    echo as separate fragments and can never reassemble in captured output.
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { platform } from 'node:os'

export const SENTINEL = '@@DSH_RESULT@@'

/** Error marker string; index.ts folds it into COLD_START_SIGNS. */
export const REPL_DIED_ERROR = 'ego-browser REPL session terminated unexpectedly'

const PROMPT = 'repl> '
/** The binary is booted through a pty wrapper; BSD `script` ships with macOS. */
const SCRIPT_BIN = '/usr/bin/script'

export interface ReplExecResult {
  ok: boolean
  value?: unknown
  error?: string
  stdout: string
}

export interface ReplExecOptions {
  timeoutMs: number
  maxOutputBytes?: number
  signal?: AbortSignal
}

function splitSentinelLiteral(script: string): string {
  // Replace occurrences of the quoted sentinel constant ('@@DSH_RESULT@@' or
  // "@@DSH_RESULT@@") with a split-concat form whose ECHO cannot reassemble.
  const pattern = new RegExp(`['\"]${SENTINEL.replace(/@/g, '\\@')}['\"]`, 'g')
  return script.replace(pattern, `'@@DSH_RE'+'SULT@@'`)
}

function wrapCell(script: string): string {
  const body = splitSentinelLiteral(script)
  return (
    `try {\n${body}\n}` +
    `catch (__egoCellErr) { console.log('@@DSH_RE'+'SULT@@' + JSON.stringify({ ok: false, error: String(__egoCellErr && __egoCellErr.message || __egoCellErr) })) }`
  )
}

function extractLastSentinel(text: string): unknown | undefined {
  let lastIndex = -1
  let parsed: unknown | undefined
  const lines = text.split(/\r?\n/)
  for (let i = lines.length - 1; i >= 0; i--) {
    const idx = lines[i]!.indexOf(SENTINEL)
    if (idx === -1) continue
    try {
      parsed = JSON.parse(lines[i]!.slice(idx + SENTINEL.length))
      lastIndex = i
      break
    } catch {
      continue
    }
  }
  void lastIndex
  return parsed
}

interface PendingRequest {
  resolve: (result: ReplExecResult) => void
  timer: NodeJS.Timeout
  abortHandler?: () => void
  signal?: AbortSignal
  sentBaseline: number
  buffer: string
  overflowed: boolean
}

export function replSupported(flavor: string): boolean {
  return platform() === 'darwin' && flavor === 'app' && existsSync(SCRIPT_BIN)
}

export class ReplSession {
  private child: ChildProcess | null = null
  private ready = false
  private dead = false
  private pending: PendingRequest | null = null
  private promptCount = 0
  private launchTail = ''
  private bootWaiters: Array<() => void> = []
  private readonly stdoutCap: number

  constructor(
    private readonly binPath: string,
    private readonly bootTimeoutMs: number,
    maxOutputBytes = 4 * 1024 * 1024,
    /** Extra/overriding env for the CLI process (engineEnv output). When
     *  omitted the REPL inherits plain process.env — which misses the
     *  EGO_BROWSER_AGENT_WORKSPACE hint engineEnv injects for app spawns,
     *  leaving official learnings site packs unresolvable. */
    private readonly envOverride: NodeJS.ProcessEnv | null = null,
  ) {
    this.stdoutCap = maxOutputBytes + 64 * 1024
  }

  get alive(): boolean {
    return this.child !== null && !this.dead
  }

  /** Spawn + wait for the REPL banner/prompt. Resolves even when the app was
   *  never contacted yet — booting the embedded runtime is what we wait for. */
  async launch(): Promise<void> {
    if (this.child !== null) return
    // -q: quiet; /dev/null: discard the typescript copy (we read the pipe).
    const child = spawn(SCRIPT_BIN, ['-q', '/dev/null', this.binPath, 'nodejs'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...(this.envOverride ?? process.env), TERM: 'dumb' },
    })
    this.child = child

    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      this.onChunk(chunk)
    })
    child.stderr?.on('data', () => {
      /* diagnostics only; protocol lives on stdout */
    })
    const failBoot = (): void => {
      this.dead = true
      this.flushBootWaiters()
      this.failPending(REPL_DIED_ERROR)
    }
    child.on('exit', failBoot)
    child.on('error', failBoot)

    const deadline = Date.now() + this.bootTimeoutMs
    while (!this.ready) {
      if (this.dead || Date.now() > deadline) {
        this.kill()
        throw new Error(`ego-browser REPL did not become ready within ${this.bootTimeoutMs}ms`)
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 50))
    }
  }

  private flushBootWaiters(): void {
    for (const wake of this.bootWaiters.splice(0)) wake()
  }

  private onChunk(chunk: string): void {
    // Cap retained output regardless of request boundaries.
    if (this.pending !== null) {
      this.pending.buffer += chunk
      if (this.pending.buffer.length > this.stdoutCap) {
        this.pending.overflowed = true
        this.pending.buffer = this.pending.buffer.slice(-this.stdoutCap)
      }
    } else {
      this.launchTail += chunk
      if (this.launchTail.length > 16_384) this.launchTail = this.launchTail.slice(-16_384)
    }

    // Count prompts wherever they appear (boot banner tail or mid-request).
    let idx = 0
    while ((idx = chunk.indexOf(PROMPT, idx)) !== -1) {
      this.promptCount += 1
      idx += PROMPT.length
    }
    if (!this.ready && (this.launchTail.includes('REPL') || this.promptCount > 0)) {
      this.ready = true
      this.flushBootWaiters()
    }
    this.settlePendingIfComplete()
  }

  private settlePendingIfComplete(): void {
    const req = this.pending
    if (req === null) return
    const settled = this.promptCount >= req.sentBaseline + 1
    if (!settled) return
    this.pending = null
    clearTimeout(req.timer)
    try {
      req.signal?.removeEventListener('abort', req.abortHandler!)
    } catch {
      /* noop */
    }
    if (req.overflowed) {
      req.resolve({
        ok: false,
        error: `REPL response exceeded ${this.stdoutCap} bytes; oldest output discarded`,
        stdout: req.buffer,
      })
      return
    }
    const value = extractLastSentinel(req.buffer)
    if (value === undefined) {
      req.resolve({
        ok: false,
        error: `REPL cell finished without a ${SENTINEL} payload`,
        stdout: req.buffer,
      })
      return
    }
    req.resolve({ ok: true, value, stdout: req.buffer })
  }

  private failPending(message: string): void {
    const req = this.pending
    if (req === null) return
    this.pending = null
    clearTimeout(req.timer)
    try {
      req.signal?.removeEventListener('abort', req.abortHandler!)
    } catch {
      /* noop */
    }
    req.resolve({ ok: false, error: message, stdout: req.buffer })
  }

  async exec(script: string, opts: ReplExecOptions): Promise<ReplExecResult> {
    if (!this.alive || !this.ready) throw new Error(REPL_DIED_ERROR)
    if (this.pending !== null) {
      // Serialized upstream by withEgoLock; two pendings mean a lock bug.
      throw new Error('internal: overlapping REPL requests are not allowed')
    }

    const promise = new Promise<ReplExecResult>((resolve) => {
      const baseline = this.promptCount
      const req: PendingRequest = {
        resolve,
        timer: setTimeout(() => {
          // Kill the whole session: its interpreter state is mid-flight and
          // unusable. Caller retries on a fresh session (warmup envelope).
          this.failPending(
            `REPL cell timed out after ${opts.timeoutMs}ms; session reset`,
          )
          this.kill()
        }, opts.timeoutMs),
        sentBaseline: baseline,
        buffer: '',
        overflowed: false,
      }
      if (opts.signal !== undefined) {
        req.signal = opts.signal
        req.abortHandler = () => {
          this.failPending('ego-browser tool aborted (harness timeout or cancellation)')
          this.kill()
        }
        if (opts.signal.aborted) {
          resolve({ ok: false, error: 'aborted before dispatch', stdout: '' })
          clearTimeout(req.timer)
          return
        }
        opts.signal.addEventListener('abort', req.abortHandler, { once: true })
      }
      this.pending = req
      try {
        this.child!.stdin!.write(`.cell\n${wrapCell(script)}\n.end\n`)
      } catch (err) {
        this.failPending(`failed to write REPL input: ${String((err as Error)?.message ?? err)}`)
        this.kill()
      }
    })

    return promise
  }

  kill(): void {
    const child = this.child
    this.child = null
    this.ready = false
    this.dead = true
    this.launchTail = ''
    if (child === undefined || child === null) return
    try {
      child.kill('SIGTERM')
    } catch {
      /* noop */
    }
    const force = setTimeout(() => {
      try {
        child.kill('SIGKILL')
      } catch {
        /* noop */
      }
    }, 3_000)
    force.unref?.()
    child.once('exit', () => clearTimeout(force))
  }
}
