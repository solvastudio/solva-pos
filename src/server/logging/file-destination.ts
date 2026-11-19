import '@tanstack/react-start/server-only'
import { join } from 'node:path'
import pino from 'pino'
import buildRollingStream, { type RollingStream } from 'pino-roll'

const LOG_FILE_BASE = 'app'
const MAX_PENDING_LINES = 2000
const REOPEN_DELAY_MS = 60_000

export interface LineSink {
  write(line: string): void
}

export interface FileSink extends LineSink {
  flush(): void
  whenOpen(): Promise<void>
}

export type BuildRollingStreamFn = typeof buildRollingStream

export interface FileSinkOptions {
  dir: string
  build?: BuildRollingStreamFn
  onProblem?: (message: string) => void
  reopenDelayMs?: number
}

export function createFileSink(options: FileSinkOptions): FileSink {
  const build = options.build ?? buildRollingStream
  const report =
    options.onProblem ?? ((msg: string) => void process.stderr.write(`${msg}\n`))
  const reopenDelayMs = options.reopenDelayMs ?? REOPEN_DELAY_MS

  let state: 'opening' | 'ready' | 'broken' = 'opening'
  let stream: RollingStream | null = null
  let opened: Promise<void> = Promise.resolve()
  const pending: string[] = []

  function fail(what: string, error: unknown): void {
    if (state === 'broken') return
    state = 'broken'
    try {
      stream?.end()
    } catch {
      /* already closed */
    }
    stream = null
    pending.length = 0
    const reason = error instanceof Error ? error.message : String(error)
    report(
      `log file ${what}: ${reason}. Logging to stdout only; retrying in ${Math.round(reopenDelayMs / 1000)}s.`,
    )
    setTimeout(open, reopenDelayMs).unref()
  }

  function open(): void {
    state = 'opening'
    opened = build({
      file: join(options.dir, LOG_FILE_BASE),
      frequency: 'daily',
      dateFormat: 'yyyy-MM-dd',
      extension: '.log',
      mkdir: true,
    })
      .then((created) => {
        created.on('error', (err) => {
          if (stream === created) fail('write failed', err)
        })
        stream = created
        state = 'ready'
        for (const line of pending.splice(0)) {
          created.write(line)
        }
      })
      .catch((err: unknown) => fail('open failed', err))
  }

  open()

  return {
    write(line: string): void {
      if (state === 'ready' && stream) {
        stream.write(line)
      } else if (state === 'opening' && pending.length < MAX_PENDING_LINES) {
        pending.push(line)
      }
    },
    flush(): void {
      try {
        stream?.flushSync()
      } catch {
        /* ignore on exit */
      }
    },
    whenOpen: () => opened,
  }
}

export function createDestination(env: {
  APP_ENV: string
  LOG_DIR: string
}): { stream: pino.DestinationStream; fileSink: FileSink | null } {
  if (env.APP_ENV === 'test' || process.env.VITEST) {
    return { stream: pino.multistream([{ stream: process.stdout }]), fileSink: null }
  }

  const fileSink = createFileSink({ dir: env.LOG_DIR })
  const fileAdapter = {
    write(msg: string): void {
      fileSink.write(msg)
    },
  }

  return {
    stream: pino.multistream([
      { level: 'trace', stream: process.stdout },
      { level: 'trace', stream: fileAdapter },
    ]),
    fileSink,
  }
}
