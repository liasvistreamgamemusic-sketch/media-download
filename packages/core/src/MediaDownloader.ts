import { mkdir, readFile, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join, resolve } from 'node:path'
import type { z } from 'zod'
import { applyMetadata, hasMetadataOverride } from './applyMetadata.js'
import { resolveBinaries } from './binaries.js'
import { buildDownloadArgs, buildProbeArgs } from './buildArgs.js'
import { classifyError } from './classifyError.js'
import { CANCELLED_ERROR, MediaDownloadError } from './errors.js'
import { parseMediaInfo } from './parseMediaInfo.js'
import { parseDownloadPercent, parseProgressLine } from './parseProgress.js'
import { runCapture, runYtDlp } from './runProcess.js'
import { DownloadSpecSchema, UrlSchema } from './schemas.js'
import type {
  BinPaths,
  BinaryOptions,
  DownloadOptions,
  DownloadResult,
  DownloadSpec,
  MediaInfo,
  ProbeOptions
} from './types.js'

// print-to-file が使えなかった場合のフォールバック: stdout から最終生成物のパスを拾う。
const RE_DESTINATION = /^\[download\] Destination:\s+(.+)$/
const RE_ALREADY = /^\[download\]\s+(.+?) has already been downloaded$/
const RE_MERGER = /^\[Merger\] Merging formats into "(.+)"$/
const RE_EXTRACT = /^\[ExtractAudio\] Destination:\s+(.+)$/
const RE_FIXUP = /^\[(?:FixupM4a|VideoConvertor|VideoRemuxer|Metadata)\].*Destination:\s+(.+)$/

const TEMP_PREFIX = '.mdl-tmp-'
const PRINT_PATH_FILE = '.mdl-filepath.txt'

/** zod 検証に通らなければ INVALID_INPUT として投げる */
function parseOrThrow<T>(schema: z.ZodType<T>, v: unknown): T {
  const r = schema.safeParse(v)
  if (r.success) return r.data
  const msg = r.error.issues.map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message)).join(' / ')
  throw new MediaDownloadError({ code: 'INVALID_INPUT', userMessage: msg, detail: msg })
}

/**
 * URL から 1 つ以上のファイルを取得するクライアント。yt-dlp の呼び出しはこのクラスの内側に閉じ込める。
 * バイナリは最初に必要になった時点で解決する（setup 前に生成しても良い）。
 */
export class MediaDownloader {
  private bins: BinPaths | null = null

  constructor(private readonly binaryOptions: BinaryOptions = {}) {}

  /** 解決済みのバイナリ。見つからなければ MediaDownloadError(ENGINE_MISSING) */
  binaries(): BinPaths {
    this.bins ??= resolveBinaries(this.binaryOptions)
    return this.bins
  }

  /** URL を解析して構造化情報を返す（ダウンロードはしない） */
  async probe(url: string, opts: ProbeOptions = {}): Promise<MediaInfo> {
    const safeUrl = parseOrThrow(UrlSchema, url)
    const bins = this.binaries()
    const args = buildProbeArgs(safeUrl, { ...opts, deno: bins.deno })
    let stdout: string
    try {
      stdout = await runCapture(bins.ytDlp, args)
    } catch (e) {
      throw new MediaDownloadError(classifyError(e instanceof Error ? e.message : String(e)))
    }
    try {
      return parseMediaInfo(JSON.parse(stdout))
    } catch (e) {
      throw new MediaDownloadError({
        code: 'UNKNOWN',
        userMessage: '解析結果を読み取れませんでした。URL をご確認ください。',
        detail: e instanceof Error ? e.message : String(e)
      })
    }
  }

  /**
   * ダウンロードして outputDir に保存する。中間ファイルは outputDir 内の一時フォルダに隔離し、
   * 成功・失敗・中断のいずれでも一時フォルダを削除する（出力先に断片を残さない）。
   * 一時フォルダを outputDir 直下に置くのは、最終 move を同一ファイルシステム内の rename で済ませるため。
   */
  async download(opts: DownloadOptions): Promise<DownloadResult> {
    const { onProgress, signal, ...rest } = opts
    const spec: DownloadSpec = parseOrThrow(DownloadSpecSchema, rest)
    if (signal?.aborted) throw new MediaDownloadError(CANCELLED_ERROR)

    const bins = this.binaries()
    if (!bins.ffmpegDir) {
      throw new MediaDownloadError({
        code: 'FFMPEG_MISSING',
        userMessage: 'ffmpeg が見つかりません。`npx media-dl setup` で導入するか、PATH に追加してください。',
        detail: ''
      })
    }

    const outputDir = resolve(spec.outputDir)
    const tempDir = join(outputDir, `${TEMP_PREFIX}${randomUUID()}`)
    await mkdir(tempDir, { recursive: true })

    let files: string[]
    try {
      files = await this.runDownload({ ...spec, outputDir }, bins, tempDir, onProgress, signal)
    } catch (e) {
      const cleanup = await removeDir(tempDir)
      if (cleanup && e instanceof MediaDownloadError) {
        throw new MediaDownloadError({ ...e.toJSON(), detail: `${e.detail}\n${cleanup}` })
      }
      throw e
    }

    const warnings: string[] = []
    const cleanup = await removeDir(tempDir)
    if (cleanup) warnings.push(cleanup)
    if (files.length === 0) warnings.push('保存先ファイルのパスを特定できませんでした。')

    if (spec.metadata && hasMetadataOverride(spec.metadata)) {
      for (const f of files) {
        try {
          await applyMetadata(bins.ffmpegDir, f, spec.metadata)
        } catch (e) {
          warnings.push(`タグの上書きに失敗しました (${f}): ${e instanceof Error ? e.message : String(e)}`)
        }
      }
    }
    return { files, warnings }
  }

  private async runDownload(
    spec: DownloadSpec,
    bins: BinPaths,
    tempDir: string,
    onProgress: DownloadOptions['onProgress'],
    signal: AbortSignal | undefined
  ): Promise<string[]> {
    // 最終パスは UTF-8 で書かれる print-to-file から取得する（cp932 等の stdout 化けを回避）。
    const printPathFile = join(tempDir, PRINT_PATH_FILE)
    const args = buildDownloadArgs(spec, bins, tempDir, printPathFile)

    let fallbackPath: string | null = null
    // 優先度: ExtractAudio/Merger/Fixup（最終生成物） > Destination/already
    const setPath = (p: string, strong: boolean): void => {
      if (strong || fallbackPath === null) fallbackPath = p.trim()
    }
    const onLine = (line: string, stream: 'out' | 'err'): void => {
      const prog = parseProgressLine(line) ?? (stream === 'out' ? parseDownloadPercent(line) : null)
      if (prog) {
        onProgress?.(prog)
        return
      }
      let m: RegExpExecArray | null
      if ((m = RE_EXTRACT.exec(line))) setPath(m[1], true)
      else if ((m = RE_MERGER.exec(line))) setPath(m[1], true)
      else if ((m = RE_FIXUP.exec(line))) setPath(m[1], true)
      else if ((m = RE_DESTINATION.exec(line))) setPath(m[1], false)
      else if ((m = RE_ALREADY.exec(line))) setPath(m[1], false)
    }

    const res = await runYtDlp(bins.ytDlp, args, onLine, signal ?? new AbortController().signal)
    if (res.killed) throw new MediaDownloadError(CANCELLED_ERROR)
    if (res.exitCode !== 0) throw new MediaDownloadError(classifyError(res.stderr))

    const printed = await readPrintedPaths(printPathFile)
    if (printed.length > 0) return printed
    return fallbackPath ? [fallbackPath] : []
  }

  /** yt-dlp のバージョン文字列 */
  async engineVersion(): Promise<string> {
    return runCapture(this.binaries().ytDlp, ['--version'])
  }

  /** yt-dlp の自己更新（yt-dlp -U）。出力文字列を返す。 */
  async updateEngine(): Promise<string> {
    return runCapture(this.binaries().ytDlp, ['-U'])
  }
}

/** print-to-file の内容（1 行 1 パス）を重複なしで返す。ファイルが無ければ空配列。 */
async function readPrintedPaths(file: string): Promise<string[]> {
  let txt: string
  try {
    txt = await readFile(file, 'utf8')
  } catch (e) {
    if (e && typeof e === 'object' && 'code' in e && e.code === 'ENOENT') return []
    throw e
  }
  const lines = txt
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
  return [...new Set(lines)]
}

/** 一時フォルダを削除する。失敗したらその理由を返す（呼び出し側で警告に載せる）。 */
async function removeDir(dir: string): Promise<string | null> {
  try {
    await rm(dir, { recursive: true, force: true })
    return null
  } catch (e) {
    return `一時フォルダを削除できませんでした (${dir}): ${e instanceof Error ? e.message : String(e)}`
  }
}
