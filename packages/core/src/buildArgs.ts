import { DEFAULT_FORMAT, FORMAT_SPECS } from './formats.js'
import type { BinPaths, CookieBrowser, DownloadSpec } from './types.js'

// ユーザー環境設定に左右されない・機械可読出力に固定する基本フラグ。
// yt-dlp 2026.03.17 の --help / 実出力で各フラグの存在を確認済み。
const BASE_FLAGS = [
  '--ignore-config',
  '--no-color',
  '--newline',
  '--no-mtime',
  '--windows-filenames', // 不正文字のみ除去。--restrict-filenames は使わない（日本語保持）
  '-N',
  '4',
  '--retries',
  '10',
  '--fragment-retries',
  '10'
]

// 機械可読な進捗（| 区切り）。実出力で field 名と NA 挙動を検証済み:
//   [PROG]|downloading|1024|NA|1024|598.58|NA
export const PROGRESS_TEMPLATE =
  'download:[PROG]|%(progress.status)s|%(progress.downloaded_bytes)s' +
  '|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s' +
  '|%(progress.speed)s|%(progress.eta)s'

// 出力テンプレート。%(title).150B のバイト長制限構文は実出力で検証済み。
export const OUTPUT_TEMPLATE = '%(title).150B [%(id)s].%(ext)s'

/** cookie 関連の引数（probe / download 共通） */
function cookieArgs(opts: { cookiesFromBrowser?: CookieBrowser; cookiesFile?: string }): string[] {
  const args: string[] = []
  if (opts.cookiesFromBrowser) args.push('--cookies-from-browser', opts.cookiesFromBrowser)
  if (opts.cookiesFile) args.push('--cookies', opts.cookiesFile)
  return args
}

/** 同梱/指定の deno を JS ランタイムに使う（YouTube 抽出の警告・フォーマット欠落を防ぐ） */
function jsRuntimeArgs(deno: string | undefined): string[] {
  return deno ? ['--js-runtimes', `deno:${deno}`] : []
}

/**
 * DownloadSpec + BinPaths から yt-dlp の引数配列を組み立てる純粋関数。
 * I/O・乱数・時刻を一切使わない。
 *
 * outputDir は絶対パスであること（呼び出し側で解決済み）。
 * 中間（断片）ファイルは tempDir に隔離し、最終ファイルだけを outputDir に置く。
 * -P は -o が絶対パスだと無視される仕様のため、-o は相対テンプレートで渡す。
 * 失敗・中断時は tempDir ごと消せば出力先に断片が残らない。
 */
export function buildDownloadArgs(
  spec: DownloadSpec,
  paths: BinPaths,
  tempDir: string,
  printPathFile: string
): string[] {
  const format = spec.format ?? DEFAULT_FORMAT
  const fs = FORMAT_SPECS[format]
  const args = [...BASE_FLAGS, '--progress-template', PROGRESS_TEMPLATE]

  if (paths.ffmpegDir) args.push('--ffmpeg-location', paths.ffmpegDir)
  args.push(...jsRuntimeArgs(paths.deno))

  // 最終ファイルパスを UTF-8 のファイルへ書き出す（yt-dlp の print-to-file は UTF-8 固定）。
  // コンソール出力（cp932 等）のパースに依存せず確実なパスを得る。プレイリストでは 1 行ずつ追記される。
  // after_move:filepath は移動後（=最終保存先）に評価され、--simulate を誘発しない。
  args.push('--print-to-file', 'after_move:filepath', printPathFile)

  args.push(
    '-P',
    `home:${spec.outputDir}`,
    '-P',
    `temp:${tempDir}`,
    '-o',
    spec.filenameTemplate ?? OUTPUT_TEMPLATE
  )

  args.push('-f', spec.formatSelector ?? fs.selector, ...fs.args)

  if (spec.embedMetadata ?? true) args.push('--embed-metadata')
  if ((spec.embedThumbnail ?? true) && fs.thumbnail) args.push('--embed-thumbnail')
  if (spec.subtitles) args.push('--write-subs', '--sub-langs', 'all')
  if (!spec.playlist) args.push('--no-playlist')
  args.push(...cookieArgs(spec))

  args.push('--', spec.url) // -- 以降を引数として確定（URL がハイフン始まりでも安全）
  return args
}

export interface ProbeArgsOptions {
  flat?: boolean
  deno?: string
  cookiesFromBrowser?: CookieBrowser
  cookiesFile?: string
}

/** probe（--dump-single-json）用の引数。capability 判定に必要な情報だけ取る。 */
export function buildProbeArgs(url: string, opts: ProbeArgsOptions = {}): string[] {
  const args = ['--ignore-config', '--no-color', '--no-warnings', '--dump-single-json']
  args.push(...jsRuntimeArgs(opts.deno))
  args.push(opts.flat ? '--flat-playlist' : '--no-playlist')
  args.push(...cookieArgs(opts))
  args.push('--', url)
  return args
}
