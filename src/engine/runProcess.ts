import { execa, type ResultPromise } from 'execa'
import treeKill from 'tree-kill'
import readline from 'node:readline'
import type { Readable } from 'node:stream'

export interface RunResult {
  exitCode: number
  stderr: string
  killed: boolean
}

export type LineHandler = (line: string, stream: 'out' | 'err') => void

function bindLineReader(stream: Readable | undefined | null, onLine: (l: string) => void): void {
  if (!stream) return
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity })
  rl.on('line', onLine)
}

/**
 * プロセスツリーごと終了する。yt-dlp は ffmpeg を子として起動するため、
 * 単純な kill では ffmpeg が孤児化する。tree-kill が OS 差異を吸収する:
 *   Windows → taskkill /pid <pid> /T /F、POSIX → ps でツリーを辿って signal。
 */
export function killTree(pid: number, signal: NodeJS.Signals = 'SIGKILL'): Promise<void> {
  return new Promise((resolve) => {
    treeKill(pid, signal, () => resolve())
  })
}

/**
 * yt-dlp を配列引数で起動し、行単位でストリーミングしながら実行する。
 * シェルを経由しない（コマンドインジェクション対策、plan.md 13章）。
 * signal.abort() でプロセスツリーごと kill する。
 */
export async function runYtDlp(
  binPath: string,
  args: string[],
  onLine: LineHandler,
  signal: AbortSignal
): Promise<RunResult> {
  const child: ResultPromise = execa(binPath, args, {
    windowsHide: true,
    buffer: false,
    encoding: 'utf8',
    reject: false,
    // POSIX では detached でプロセスグループを作り、ツリー kill の確実性を上げる
    detached: process.platform !== 'win32',
    stdout: 'pipe',
    stderr: 'pipe'
  })

  // detached でプロセスグループを作った場合、親の event loop を専有しないよう unref する。
  if (process.platform !== 'win32') child.unref()

  let killed = false
  const stderrChunks: string[] = []

  bindLineReader(child.stdout, (l) => onLine(l, 'out'))
  bindLineReader(child.stderr, (l) => {
    stderrChunks.push(l)
    onLine(l, 'err')
  })

  const onAbort = (): void => {
    killed = true
    if (child.pid) void killTree(child.pid)
  }
  if (signal.aborted) onAbort()
  else signal.addEventListener('abort', onAbort, { once: true })

  try {
    const res = await child
    return {
      exitCode: typeof res.exitCode === 'number' ? res.exitCode : killed ? 1 : 0,
      stderr: stderrChunks.join('\n'),
      killed
    }
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
}

/** 単発実行（version 取得等）。stdout 全体を返す。 */
export async function runCapture(binPath: string, args: string[]): Promise<string> {
  const res = await execa(binPath, args, { windowsHide: true, reject: false, encoding: 'utf8' })
  if (res.exitCode !== 0) {
    throw new Error(res.stderr || `exit ${res.exitCode}`)
  }
  return (res.stdout ?? '').trim()
}
