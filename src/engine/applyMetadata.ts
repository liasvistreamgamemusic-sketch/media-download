import { rename, rm } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import { runCapture } from './runProcess'
import type { MetadataOverride } from '../shared/types'

const EXE = process.platform === 'win32' ? '.exe' : ''

/** 非空の上書きフィールドが1つでもあるか（空文字・空白のみは「指定なし」扱い）。 */
export function hasMetadataOverride(meta?: MetadataOverride): boolean {
  if (!meta) return false
  return [meta.title, meta.artist, meta.album, meta.comment].some((v) => !!v && v.trim() !== '')
}

/**
 * ffmpeg でメタデータを上書きするための引数を組み立てる純粋関数。
 * -map 0 -c copy で全ストリーム（埋め込みサムネ含む）を再エンコードせず保持し、
 * 指定タグのみ上書きする。値はシェルを介さず配列要素として渡すため、
 * スペース・コロン・% ・引用符・改行・日本語をエスケープ無しで安全に扱える。
 */
export function buildMetadataFfmpegArgs(
  input: string,
  output: string,
  meta: MetadataOverride
): string[] {
  const args = ['-i', input, '-map', '0', '-c', 'copy']
  // id3v2_version は mp3 マルチプレクサ専用オプション。他コンテナに渡すと ffmpeg がエラーになる。
  if (extname(output).toLowerCase() === '.mp3') args.push('-id3v2_version', '3')
  const add = (key: string, val?: string): void => {
    if (val && val.trim() !== '') args.push('-metadata', `${key}=${val}`)
  }
  add('title', meta.title)
  add('artist', meta.artist)
  add('album', meta.album)
  add('comment', meta.comment)
  args.push('-y', output)
  return args
}

/**
 * ダウンロード済みファイルの埋め込みタグをユーザー指定値で上書きする。
 * 同ディレクトリに一時ファイルを書き出してから元ファイルへ置換する（in-place 不可のため）。
 * 上書き対象が無ければ何もしない。失敗は呼び出し側で握って best-effort 扱いにする。
 */
export async function applyMetadata(
  ffmpegDir: string,
  filePath: string,
  meta: MetadataOverride
): Promise<void> {
  if (!hasMetadataOverride(meta)) return
  const ffmpeg = join(ffmpegDir, `ffmpeg${EXE}`)
  const ext = extname(filePath)
  const tmp = join(dirname(filePath), `${basename(filePath, ext)}.mdl-meta${ext}`)
  const args = buildMetadataFfmpegArgs(filePath, tmp, meta)
  await runCapture(ffmpeg, args) // 非ゼロ終了は throw される
  await rm(filePath, { force: true })
  await rename(tmp, filePath)
}
