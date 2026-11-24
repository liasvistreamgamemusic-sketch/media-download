// 実行バイナリ（yt-dlp / ffmpeg / deno）の場所を解決する。
// 優先順位（項目ごと）: 明示指定 → 環境変数 → binDir（`media-dl setup` の導入先） → PATH
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'
import { MediaDownloadError } from './errors.js'
import type { BinPaths, BinaryOptions } from './types.js'

/** 利用者が設定できる環境変数名（README の表と一致させること） */
export const ENV = {
  BIN_DIR: 'MEDIA_DL_BIN_DIR',
  YT_DLP: 'MEDIA_DL_YTDLP',
  FFMPEG_DIR: 'MEDIA_DL_FFMPEG_DIR',
  DENO: 'MEDIA_DL_DENO'
} as const

const APP_DIR_NAME = 'media-dl'

// GUI 起動時（macOS の Finder 等）は PATH が痩せていることがあるため代表的な場所を補う
const EXTRA_SEARCH_DIRS = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin']

type Env = Record<string, string | undefined>

export function exeName(name: string, platform: NodeJS.Platform = process.platform): string {
  return platform === 'win32' ? `${name}.exe` : name
}

/** `media-dl setup` の既定導入先（OS ごとのユーザーキャッシュ配下） */
export function defaultBinDir(env: Env = process.env, platform: NodeJS.Platform = process.platform): string {
  const home = homedir()
  if (platform === 'win32') {
    return join(env.LOCALAPPDATA ?? join(home, 'AppData', 'Local'), APP_DIR_NAME, 'bin')
  }
  if (platform === 'darwin') return join(home, 'Library', 'Caches', APP_DIR_NAME, 'bin')
  return join(env.XDG_CACHE_HOME ?? join(home, '.cache'), APP_DIR_NAME, 'bin')
}

/** PATH（+ 代表的な場所）から実行ファイルを含むディレクトリを探す */
export function findOnPath(name: string, env: Env = process.env): string | null {
  const dirs = (env.PATH ?? '').split(delimiter).filter(Boolean)
  for (const dir of [...dirs, ...EXTRA_SEARCH_DIRS]) {
    if (existsSync(join(dir, exeName(name)))) return dir
  }
  return null
}

function missing(code: 'ENGINE_MISSING' | 'FFMPEG_MISSING', what: string, given: string): MediaDownloadError {
  return new MediaDownloadError({
    code,
    userMessage: `${what}が見つかりません: ${given}`,
    detail: given
  })
}

/**
 * バイナリを解決する。yt-dlp が無ければ ENGINE_MISSING を投げる。
 * ffmpeg は見つからなければ null（解析だけなら不要なため、必要になった時点で呼び出し側が判断する）。
 * 明示指定・環境変数で指定されたパスが存在しない場合は、黙って他を探さずにエラーにする。
 */
export function resolveBinaries(opts: BinaryOptions = {}, env: Env = process.env): BinPaths {
  const binDir = opts.binDir ?? env[ENV.BIN_DIR] ?? defaultBinDir(env)

  const ytDlpGiven = opts.ytDlp ?? env[ENV.YT_DLP]
  let ytDlp: string | null
  if (ytDlpGiven) {
    if (!existsSync(ytDlpGiven)) throw missing('ENGINE_MISSING', 'yt-dlp ', ytDlpGiven)
    ytDlp = ytDlpGiven
  } else {
    const cached = join(binDir, exeName('yt-dlp'))
    const onPath = findOnPath('yt-dlp', env)
    ytDlp = existsSync(cached) ? cached : onPath ? join(onPath, exeName('yt-dlp')) : null
  }
  if (!ytDlp) {
    throw new MediaDownloadError({
      code: 'ENGINE_MISSING',
      userMessage:
        'yt-dlp が見つかりません。`npx media-dl setup` で導入するか、環境変数 ' +
        `${ENV.YT_DLP} でパスを指定してください。`,
      detail: `searched: ${binDir}, PATH`
    })
  }

  const ffmpegGiven = opts.ffmpegDir ?? env[ENV.FFMPEG_DIR]
  let ffmpegDir: string | null
  if (ffmpegGiven) {
    if (!existsSync(join(ffmpegGiven, exeName('ffmpeg')))) {
      throw missing('FFMPEG_MISSING', 'ffmpeg ', join(ffmpegGiven, exeName('ffmpeg')))
    }
    ffmpegDir = ffmpegGiven
  } else {
    ffmpegDir = existsSync(join(binDir, exeName('ffmpeg'))) ? binDir : findOnPath('ffmpeg', env)
  }

  const denoGiven = opts.deno ?? env[ENV.DENO]
  let deno: string | undefined
  if (denoGiven) {
    if (!existsSync(denoGiven)) throw missing('ENGINE_MISSING', 'deno ', denoGiven)
    deno = denoGiven
  } else {
    const cached = join(binDir, exeName('deno'))
    deno = existsSync(cached) ? cached : undefined
  }

  return { ytDlp, ffmpegDir, deno }
}
