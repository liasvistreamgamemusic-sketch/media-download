import path from 'node:path'
import type { BinPaths, DownloadRequest } from '../shared/types'

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

/**
 * DownloadRequest + BinPaths から yt-dlp の引数配列を組み立てる純粋関数。
 * I/O・乱数・時刻を一切使わない。
 */
export function buildDownloadArgs(req: DownloadRequest, paths: BinPaths, tempDir?: string): string[] {
  const args = [
    ...BASE_FLAGS,
    '--ffmpeg-location',
    paths.ffmpegDir,
    '--progress-template',
    PROGRESS_TEMPLATE
  ]

  // 同梱 deno を JS ランタイムとして指定（YouTube 抽出の deprecation 警告・フォーマット欠落を防ぐ）。
  if (paths.deno) args.push('--js-runtimes', `deno:${paths.deno}`)

  // 出力先と中間（断片）ファイルの置き場。tempDir 指定時は中間ファイルを隔離する。
  // 注意: -P は -o が絶対パスだと丸ごと無視される仕様。そのため tempDir 指定時は
  // -o を相対テンプレートにし、最終出力先=home / 中間=temp を -P で与える。
  // これで失敗・中断時に temp ディレクトリごと消せば、出力先に断片が残らない。
  if (tempDir) {
    args.push('-P', `home:${req.outputDir}`, '-P', `temp:${tempDir}`, '-o', OUTPUT_TEMPLATE)
  } else {
    args.push('-o', path.join(req.outputDir, OUTPUT_TEMPLATE))
  }

  switch (req.kind) {
    case 'video_best':
      args.push('-f', req.formatId ?? 'bv*+ba/b', '--merge-output-format', 'mp4')
      break
    case 'audio_mp3':
      // -x は後処理であってフォーマット選択を変えない。-f を音声のみに固定しないと
      // 既定の bv*+ba/b で映像も取得し、YouTube の SABR/403 で映像DLだけ失敗→
      // ジョブ失敗＋断片ファイル残留の原因になる（音声のみなら起きない）。
      args.push('-f', req.formatId ?? 'ba/b', '-x', '--audio-format', 'mp3', '--audio-quality', '0')
      break
    case 'audio_lossless':
      // -x: 元コーデックを維持したまま音声コンテナへリマックス（webm→opus, m4a→m4a）。
      // --audio-format を付けない＝再エンコードなし。これでサムネ埋め込み対応コンテナになる
      // （.webm は --embed-thumbnail 非対応のため -x 無しだと後処理で失敗する）。
      args.push('-f', req.formatId ?? 'ba/b', '-x')
      break
  }

  if (req.embedMetadata) args.push('--embed-metadata')
  if (req.embedThumbnail) args.push('--embed-thumbnail')
  if (req.writeSubs) args.push('--write-subs', '--sub-langs', 'all')
  if (req.noPlaylist) args.push('--no-playlist')
  if (req.cookiesFromBrowser) args.push('--cookies-from-browser', req.cookiesFromBrowser)

  args.push('--', req.url) // -- 以降を引数として確定（URL がハイフン始まりでも安全）
  return args
}

/** probe（--dump-single-json）用の引数。capability 判定に必要な情報だけ取る。 */
export function buildProbeArgs(url: string, flat = false, denoPath?: string): string[] {
  const args = ['--ignore-config', '--no-color', '--no-warnings', '--dump-single-json']
  // probe も YouTube に当たるため同梱 deno を指定（フォーマット欠落で誤判定を防ぐ）。
  if (denoPath) args.push('--js-runtimes', `deno:${denoPath}`)
  if (flat) args.push('--flat-playlist')
  else args.push('--no-playlist')
  args.push('--', url)
  return args
}
