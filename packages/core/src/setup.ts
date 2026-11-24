// `media-dl setup`: yt-dlp / ffmpeg / ffprobe / deno をユーザーキャッシュへ導入する。
// npm パッケージにバイナリを同梱しない（巨大・OS 依存のため）。初回に 1 回だけ取得する。
import { chmod, mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { defaultBinDir, ENV, exeName, findOnPath } from './binaries.js'
import { extractZipEntry } from './unzip.js'

// 取得元。いずれも 2026-11-24 に各アセットの存在（HTTP 200）を確認済み。
const YT_DLP_BASE = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download'
// ffmpeg-static（npm）が配布している静的ビルド。タグは ffmpeg-static 5.3.0 の binary-release-tag。
const FFMPEG_STATIC_BASE = 'https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1'
const FFMPEG_TARGETS = new Set(['win32-x64', 'darwin-x64', 'darwin-arm64', 'linux-x64', 'linux-arm64'])
const DENO_BASE = 'https://github.com/denoland/deno/releases/latest/download'

export type BinaryName = 'yt-dlp' | 'ffmpeg' | 'ffprobe' | 'deno'

interface Asset {
  url: string
  unpack: (data: Buffer) => Buffer
}

const raw = (d: Buffer): Buffer => d
const gunzip = (d: Buffer): Buffer => gunzipSync(d)

function ytDlpAsset(platform: NodeJS.Platform, arch: string): string | null {
  if (platform === 'win32' && arch === 'x64') return 'yt-dlp.exe'
  if (platform === 'darwin') return 'yt-dlp_macos' // universal
  if (platform === 'linux' && arch === 'x64') return 'yt-dlp_linux'
  if (platform === 'linux' && arch === 'arm64') return 'yt-dlp_linux_aarch64'
  return null
}

function denoTriple(platform: NodeJS.Platform, arch: string): string | null {
  const a = arch === 'x64' ? 'x86_64' : arch === 'arm64' ? 'aarch64' : null
  if (!a) return null
  if (platform === 'win32') return a === 'x86_64' ? 'x86_64-pc-windows-msvc' : null
  if (platform === 'darwin') return `${a}-apple-darwin`
  if (platform === 'linux') return `${a}-unknown-linux-gnu`
  return null
}

/** プラットフォームごとの取得元。未対応の組み合わせは null。 */
export function assetFor(
  bin: BinaryName,
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch
): Asset | null {
  switch (bin) {
    case 'yt-dlp': {
      const a = ytDlpAsset(platform, arch)
      return a ? { url: `${YT_DLP_BASE}/${a}`, unpack: raw } : null
    }
    case 'ffmpeg':
    case 'ffprobe':
      if (!FFMPEG_TARGETS.has(`${platform}-${arch}`)) return null
      return { url: `${FFMPEG_STATIC_BASE}/${bin}-${platform}-${arch}.gz`, unpack: gunzip }
    case 'deno': {
      const t = denoTriple(platform, arch)
      const inner = exeName('deno', platform)
      return t ? { url: `${DENO_BASE}/deno-${t}.zip`, unpack: (d) => extractZipEntry(d, inner) } : null
    }
  }
}

export interface SetupOptions {
  binDir?: string
  /** 既にあっても再取得する（yt-dlp を最新化したいとき等） */
  force?: boolean
  /** 進捗メッセージ（CLI が stderr に出す） */
  log?: (msg: string) => void
}

export interface SetupResult {
  binDir: string
  installed: BinaryName[]
  skipped: { name: BinaryName; reason: string }[]
}

async function fetchBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`)
  return Buffer.from(await res.arrayBuffer())
}

const ALL: BinaryName[] = ['yt-dlp', 'ffmpeg', 'ffprobe', 'deno']

/**
 * 足りないバイナリを binDir に導入する。PATH に既にあるもの（ffmpeg / deno）は force でなければ取得しない。
 * 書き込みは一時名 → rename で行い、途中失敗で壊れた実行ファイルを残さない。
 */
export async function setupBinaries(opts: SetupOptions = {}): Promise<SetupResult> {
  const binDir = opts.binDir ?? process.env[ENV.BIN_DIR] ?? defaultBinDir()
  const log = opts.log ?? ((): void => undefined)
  await mkdir(binDir, { recursive: true })

  const result: SetupResult = { binDir, installed: [], skipped: [] }
  for (const name of ALL) {
    const dest = join(binDir, exeName(name))
    if (!opts.force && existsSync(dest)) {
      result.skipped.push({ name, reason: `導入済み (${dest})` })
      continue
    }
    // yt-dlp は常に自前で持つ（PATH 上の古い版より最新版を使いたいため）。
    // ffprobe は ffmpeg と同じディレクトリで使われるため、ffmpeg の有無で判断する。
    const onPath = name === 'yt-dlp' ? null : findOnPath(name === 'ffprobe' ? 'ffmpeg' : name)
    if (!opts.force && onPath) {
      result.skipped.push({ name, reason: `PATH 上にあり (${onPath})` })
      continue
    }
    const asset = assetFor(name)
    if (!asset) {
      result.skipped.push({ name, reason: `${process.platform}/${process.arch} 用の配布物がありません` })
      continue
    }
    log(`download ${name}: ${asset.url}`)
    const bytes = asset.unpack(await fetchBuffer(asset.url))
    const tmp = `${dest}.download`
    try {
      await writeFile(tmp, bytes)
      if (process.platform !== 'win32') await chmod(tmp, 0o755)
      await rename(tmp, dest)
    } catch (e) {
      await rm(tmp, { force: true })
      throw e
    }
    result.installed.push(name)
  }
  return result
}
