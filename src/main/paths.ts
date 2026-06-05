import { app } from 'electron'
import { existsSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import type { BinPaths } from '../shared/types'

const EXE = process.platform === 'win32' ? '.exe' : ''

/**
 * yt-dlp 格納ディレクトリの解決。優先順位は:
 *   1. userData/bin（yt-dlp -U で更新した版。plan.md 16.3）
 *   2. dev: <project>/resources/bin
 *   3. prod: process.resourcesPath/bin
 */
function resolveBinRoot(): string {
  const userBin = join(app.getPath('userData'), 'bin')
  if (existsSync(join(userBin, `yt-dlp${EXE}`))) return userBin

  return app.isPackaged
    ? join(process.resourcesPath, 'bin')
    : join(app.getAppPath(), 'resources', 'bin')
}

/**
 * ffmpeg ディレクトリの解決。yt-dlp とは独立に解決する:
 *   1. 同梱の静的 ffmpeg があればそれ（Windows 配布 / userData 更新版）
 *   2. 開発時フォールバック: システムにインストール済みの ffmpeg（macOS の Homebrew 等）
 *
 * 注: Homebrew の ffmpeg は動的リンクのため resources/bin へコピーすると単体起動できない。
 * 開発時は実インストール位置のディレクトリを --ffmpeg-location に渡す。
 */
function resolveFfmpegDir(binRoot: string): string {
  if (existsSync(join(binRoot, `ffmpeg${EXE}`))) return binRoot

  const sys = findSystemFfmpegDir()
  if (sys) return sys

  // 見つからない場合は binRoot を返し、起動失敗を classifyError(FFMPEG_MISSING) に委ねる
  return binRoot
}

function findSystemFfmpegDir(): string | null {
  const dirs = (process.env.PATH ?? '').split(delimiter).filter(Boolean)
  // GUI 起動時は PATH が痩せていることがあるため代表的な場所を明示的に補う
  dirs.push('/opt/homebrew/bin', '/usr/local/bin', '/usr/bin')
  for (const dir of dirs) {
    if (existsSync(join(dir, `ffmpeg${EXE}`))) return dir
  }
  return null
}

export function getBinPaths(): BinPaths {
  const root = resolveBinRoot()
  return {
    ytDlp: join(root, `yt-dlp${EXE}`),
    ffmpegDir: resolveFfmpegDir(root) // yt-dlp --ffmpeg-location にはディレクトリを渡す
  }
}

/** userData/bin（自己更新版の配置先） */
export function getUserBinDir(): string {
  return join(app.getPath('userData'), 'bin')
}
