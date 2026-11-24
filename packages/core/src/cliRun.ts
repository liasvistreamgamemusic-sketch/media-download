// CLI の実行部。入出力は引数の io に限定し、テストから差し替えられるようにする。
import { FORMAT_SPECS, OUTPUT_FORMATS } from './formats.js'
import { toErrorInfo } from './errors.js'
import { formatBytes, formatDuration, formatSpeed } from './humanize.js'
import { MediaDownloader } from './MediaDownloader.js'
import { setupBinaries } from './setup.js'
import { parseCliArgs, USAGE, UsageError, type CliCommand } from './cliArgs.js'
import type { DownloadProgress, MediaInfo } from './types.js'

export interface CliIO {
  stdout: (s: string) => void
  stderr: (s: string) => void
  /** stderr が端末か（進捗を同じ行で上書き表示するかの判定） */
  isTTY: boolean
  version: string
  /** Ctrl+C などで中断するためのシグナル */
  signal: AbortSignal
}

export const EXIT = { OK: 0, FAILED: 1, USAGE: 2, CANCELLED: 130 } as const

function progressLine(p: DownloadProgress): string {
  if (p.status === 'postprocessing') return '  変換・結合中…'
  const pct = p.percent != null ? `${p.percent.toFixed(1).padStart(5)}%` : '   --%'
  const size = p.totalBytes != null ? `${formatBytes(p.downloadedBytes)} / ${formatBytes(p.totalBytes)}` : ''
  const speed = p.speedBps != null ? formatSpeed(p.speedBps) : ''
  const eta = p.etaSec != null ? `残り ${formatDuration(p.etaSec)}` : ''
  return `  ${[pct, size, speed, eta].filter(Boolean).join('  ')}`
}

/** 調査用の詳細（userMessage と同じなら出さない）を字下げして返す */
function detailBlock(detail: string, userMessage: string): string {
  if (!detail || detail === userMessage) return ''
  return `  ${detail.split('\n').join('\n  ')}\n`
}

function describeInfo(info: MediaInfo): string {
  const lines = [
    `タイトル : ${info.title}`,
    `投稿者   : ${info.uploader ?? '—'}`,
    `サイト   : ${info.extractor}`,
    `長さ     : ${formatDuration(info.durationSec)}`,
    `内容     : ${[info.hasVideo && '映像', info.hasAudio && '音声'].filter(Boolean).join(' + ') || '不明'}`
  ]
  if (info.isPlaylist) lines.push(`プレイリスト: ${info.playlistCount ?? '?'} 件（全件取得は --playlist）`)
  return lines.join('\n')
}

async function runDownload(cmd: Extract<CliCommand, { kind: 'download' }>, io: CliIO): Promise<number> {
  const dl = new MediaDownloader({ binDir: cmd.binDir })
  const showProgress = !cmd.json && !cmd.quiet && io.isTTY
  let failed = 0

  for (const url of cmd.urls) {
    let lastLen = 0
    const clearLine = (): void => {
      if (lastLen > 0) io.stderr(`\r${' '.repeat(lastLen)}\r`)
      lastLen = 0
    }
    try {
      if (!cmd.json && !cmd.quiet) io.stderr(`取得中: ${url}\n`)
      const result = await dl.download({
        ...cmd.spec,
        url,
        signal: io.signal,
        onProgress: (p) => {
          if (cmd.json) io.stdout(JSON.stringify({ type: 'progress', url, ...p }) + '\n')
          else if (showProgress) {
            const line = progressLine(p)
            io.stderr(`\r${line.padEnd(lastLen)}`)
            lastLen = line.length
          }
        }
      })
      clearLine()
      if (cmd.json) {
        io.stdout(JSON.stringify({ type: 'done', url, ...result }) + '\n')
      } else {
        for (const f of result.files) io.stdout(`${f}\n`)
        for (const w of result.warnings) io.stderr(`警告: ${w}\n`)
      }
    } catch (e) {
      clearLine()
      const info = toErrorInfo(e)
      if (info.code === 'CANCELLED') {
        if (cmd.json) io.stdout(JSON.stringify({ type: 'error', url, ...info }) + '\n')
        else io.stderr(`${info.userMessage}\n`)
        return EXIT.CANCELLED
      }
      failed++
      if (cmd.json) io.stdout(JSON.stringify({ type: 'error', url, ...info }) + '\n')
      else io.stderr(`エラー [${info.code}] ${url}\n  ${info.userMessage}\n${detailBlock(info.detail, info.userMessage)}`)
    }
  }
  return failed > 0 ? EXIT.FAILED : EXIT.OK
}

async function execute(cmd: CliCommand, io: CliIO): Promise<number> {
  switch (cmd.kind) {
    case 'help':
      io.stdout(`${USAGE}\n`)
      return EXIT.OK
    case 'version':
      io.stdout(`${io.version}\n`)
      return EXIT.OK
    case 'formats':
      for (const f of OUTPUT_FORMATS) io.stdout(`${f.padEnd(6)} ${FORMAT_SPECS[f].label}\n`)
      return EXIT.OK
    case 'setup': {
      const r = await setupBinaries({ binDir: cmd.binDir, force: cmd.force, log: (m) => io.stderr(`${m}\n`) })
      for (const n of r.installed) io.stderr(`導入: ${n}\n`)
      for (const s of r.skipped) io.stderr(`スキップ: ${s.name} — ${s.reason}\n`)
      io.stdout(`${r.binDir}\n`)
      return EXIT.OK
    }
    case 'update':
      io.stdout(`${await new MediaDownloader({ binDir: cmd.binDir }).updateEngine()}\n`)
      return EXIT.OK
    case 'info': {
      const info = await new MediaDownloader({ binDir: cmd.binDir }).probe(cmd.url, {
        cookiesFromBrowser: cmd.cookiesFromBrowser,
        cookiesFile: cmd.cookiesFile
      })
      io.stdout(cmd.json ? `${JSON.stringify(info)}\n` : `${describeInfo(info)}\n`)
      return EXIT.OK
    }
    case 'download':
      return runDownload(cmd, io)
  }
}

/** CLI のエントリ。終了コードを返す（process.exit はしない）。 */
export async function runCli(argv: string[], io: CliIO): Promise<number> {
  let cmd: CliCommand
  try {
    cmd = parseCliArgs(argv)
  } catch (e) {
    if (!(e instanceof UsageError)) throw e
    io.stderr(`${e.message}\n\n${USAGE}\n`)
    return EXIT.USAGE
  }
  try {
    return await execute(cmd, io)
  } catch (e) {
    const info = toErrorInfo(e)
    io.stderr(`エラー [${info.code}] ${info.userMessage}\n${detailBlock(info.detail, info.userMessage)}`)
    return EXIT.FAILED
  }
}
