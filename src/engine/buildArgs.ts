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
export function buildDownloadArgs(req: DownloadRequest, paths: BinPaths): string[] {
  const out = path.join(req.outputDir, OUTPUT_TEMPLATE)

  const args = [
    ...BASE_FLAGS,
    '--ffmpeg-location',
    paths.ffmpegDir,
    '--progress-template',
    PROGRESS_TEMPLATE,
    '-o',
    out
  ]

  switch (req.kind) {
    case 'video_best':
      args.push('-f', req.formatId ?? 'bv*+ba/b', '--merge-output-format', 'mp4')
      break
    case 'audio_mp3':
      args.push('-x', '--audio-format', 'mp3', '--audio-quality', '0')
      if (req.formatId) args.push('-f', req.formatId)
      break
    case 'audio_lossless':
      args.push('-f', req.formatId ?? 'ba/b') // 再エンコードせず元コーデック維持
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
export function buildProbeArgs(url: string, flat = false): string[] {
  const args = ['--ignore-config', '--no-color', '--no-warnings', '--dump-single-json']
  if (flat) args.push('--flat-playlist')
  else args.push('--no-playlist')
  args.push('--', url)
  return args
}
