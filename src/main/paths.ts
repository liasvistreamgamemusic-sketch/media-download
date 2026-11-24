import { app } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { exeName, type BinaryOptions } from '@liasvistreamgamemusic-sketch/media-dl'

/**
 * 同梱バイナリの格納ディレクトリ。優先順位は:
 *   1. userData/bin（yt-dlp -U で更新した版。plan.md 16.3）
 *   2. dev: <project>/resources/bin
 *   3. prod: process.resourcesPath/bin
 */
function resolveBinRoot(): string {
  const userBin = join(app.getPath('userData'), 'bin')
  if (existsSync(join(userBin, exeName('yt-dlp')))) return userBin

  return app.isPackaged
    ? join(process.resourcesPath, 'bin')
    : join(app.getAppPath(), 'resources', 'bin')
}

/**
 * core に渡すバイナリ指定。同梱物があるものだけ明示し、無いもの（開発時の ffmpeg 等）は
 * core の探索（環境変数 → キャッシュ → PATH・Homebrew）に任せる。
 *
 * 注: Homebrew の ffmpeg は動的リンクのため resources/bin へコピーすると単体起動できない。
 * 開発時は実インストール位置のディレクトリが core の PATH 探索で選ばれる。
 */
export function getBinaryOptions(): BinaryOptions {
  const root = resolveBinRoot()
  const ytDlp = join(root, exeName('yt-dlp'))
  const deno = join(root, exeName('deno'))
  return {
    ytDlp: existsSync(ytDlp) ? ytDlp : undefined,
    ffmpegDir: existsSync(join(root, exeName('ffmpeg'))) ? root : undefined,
    deno: existsSync(deno) ? deno : undefined
  }
}
