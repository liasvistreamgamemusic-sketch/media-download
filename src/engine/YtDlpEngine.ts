import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { buildDownloadArgs, buildProbeArgs } from './buildArgs'
import { parseProgressLine, parseDownloadPercent } from './parseProgress'
import { parseMediaInfo } from './parseMediaInfo'
import { classifyError } from './classifyError'
import { runCapture, runYtDlp } from './runProcess'
import type { DownloadHooks, MediaEngine, ProbeOptions } from './MediaEngine'
import type { BinPaths, DownloadRequest, DownloadResult, MediaInfo } from '../shared/types'

// 出力パスを stdout から拾うためのパターン（最終生成物を優先）。
const RE_DESTINATION = /^\[download\] Destination:\s+(.+)$/
const RE_ALREADY = /^\[download\]\s+(.+?) has already been downloaded$/
const RE_MERGER = /^\[Merger\] Merging formats into "(.+)"$/
const RE_EXTRACT = /^\[ExtractAudio\] Destination:\s+(.+)$/
const RE_FIXUP = /^\[(?:FixupM4a|VideoConvertor|Metadata)\].*Destination:\s+(.+)$/

/** AppError を内包して throw するための型付き例外 */
export class EngineError extends Error {
  constructor(public readonly appError: ReturnType<typeof classifyError>) {
    super(appError.userMessage)
    this.name = 'EngineError'
  }
}

export class YtDlpEngine implements MediaEngine {
  constructor(private readonly paths: BinPaths) {}

  async probe(url: string, opts: ProbeOptions = {}): Promise<MediaInfo> {
    const args = buildProbeArgs(url, opts.flat, this.paths.deno)
    let stdout: string
    try {
      stdout = await runCapture(this.paths.ytDlp, args)
    } catch (e) {
      // プロセス起動・非ゼロ終了はエラー分類（stderr 文言から導出）
      const stderr = e instanceof Error ? e.message : String(e)
      throw new EngineError(classifyError(stderr))
    }
    // ここからは解析失敗。yt-dlp の生 stderr ではなく解析エラーとして UNKNOWN に分類する。
    try {
      return parseMediaInfo(JSON.parse(stdout))
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e)
      throw new EngineError({
        code: 'UNKNOWN',
        userMessage: '解析結果を読み取れませんでした。URL をご確認ください。',
        detail
      })
    }
  }

  async download(req: DownloadRequest, hooks: DownloadHooks): Promise<DownloadResult> {
    // 最終パスは UTF-8 で書かれる print-to-file から取得する（cp932 等の stdout 化けを回避）。
    const printPathFile = hooks.tempDir ? join(hooks.tempDir, '.mdl-filepath.txt') : undefined
    const args = buildDownloadArgs(req, this.paths, hooks.tempDir, printPathFile)

    let finalPath: string | null = null
    // 優先度: ExtractAudio/Merger/Fixup（最終生成物） > Destination/already
    const setPath = (p: string, strong: boolean): void => {
      if (strong || finalPath === null) finalPath = p.trim()
    }

    const onLine = (line: string, stream: 'out' | 'err'): void => {
      const prog = parseProgressLine(line, '') ?? (stream === 'out' ? parseDownloadPercent(line, '') : null)
      if (prog) {
        hooks.onProgress({ ...prog, jobId: '' })
        return
      }
      let m: RegExpExecArray | null
      if ((m = RE_EXTRACT.exec(line))) setPath(m[1], true)
      else if ((m = RE_MERGER.exec(line))) setPath(m[1], true)
      else if ((m = RE_FIXUP.exec(line))) setPath(m[1], true)
      else if ((m = RE_DESTINATION.exec(line))) setPath(m[1], false)
      else if ((m = RE_ALREADY.exec(line))) setPath(m[1], false)
    }

    const res = await runYtDlp(this.paths.ytDlp, args, onLine, hooks.signal)

    if (res.killed) {
      throw new EngineError({ code: 'CANCELLED', userMessage: 'ダウンロードを中止しました。', detail: '' })
    }
    if (res.exitCode !== 0) {
      throw new EngineError(classifyError(res.stderr))
    }

    // print-to-file（UTF-8）の最終パスを優先。読めなければ stdout パース結果にフォールバック。
    let outputPath: string | null = finalPath
    if (printPathFile) {
      try {
        const txt = await readFile(printPathFile, 'utf8')
        const last = txt
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter(Boolean)
          .pop()
        if (last) outputPath = last
      } catch {
        // ファイルが無い/読めない場合は finalPath を使う
      }
    }
    return { jobId: '', outputPath }
  }

  async engineVersion(): Promise<string> {
    return runCapture(this.paths.ytDlp, ['--version'])
  }

  async updateEngine(): Promise<string> {
    // 同梱版が Program Files 配下だと権限不足で失敗しうる（plan.md 16.3）。
    // ここでは -U を実行し、出力をそのまま返す（失敗時も文言を渡す）。
    try {
      return await runCapture(this.paths.ytDlp, ['-U'])
    } catch (e) {
      return e instanceof Error ? e.message : String(e)
    }
  }
}
