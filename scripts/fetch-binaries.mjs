#!/usr/bin/env node
// resources/bin に yt-dlp / ffmpeg / ffprobe を配置する。
//   - yt-dlp        : GitHub releases から取得（macOS 版は arm64+x64 のユニバーサル）
//   - ffmpeg/ffprobe: ffmpeg-static / ffprobe-static（静的ビルド）
//
// モード:
//   （既定）       現在のプラットフォーム向け（host arch）
//   --mac-universal  macOS 用に arm64+x64 ユニバーサル ffmpeg を lipo で合成（Intel/Apple Silicon 両対応）
//
// すべて静的バイナリのため配布パッケージにそのまま同梱できる（システムの ffmpeg 非依存）。
import { createRequire } from 'node:module'
import { execFile } from 'node:child_process'
import { mkdir, chmod, access, rm, copyFile, writeFile } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { gunzipSync } from 'node:zlib'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileP = promisify(execFile)
const require = createRequire(import.meta.url)
const __dirname = dirname(fileURLToPath(import.meta.url))
const BIN = join(__dirname, '..', 'resources', 'bin')
const force = process.argv.includes('--force')
const universalMac = process.argv.includes('--mac-universal')
const targetOS = universalMac
  ? 'darwin'
  : (process.argv.find((a) => a.startsWith('--os='))?.slice(5) ?? process.platform)
const EXE = targetOS === 'win32' ? '.exe' : ''

const exists = (p) =>
  access(p)
    .then(() => true)
    .catch(() => false)

async function fetchBuffer(url) {
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  return Buffer.from(await res.arrayBuffer())
}

async function download(url, dest) {
  if (!force && (await exists(dest))) {
    console.log(`skip (exists): ${dest}`)
    return
  }
  console.log(`download: ${url}`)
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} for ${url}`)
  await pipeline(res.body, createWriteStream(dest))
}

async function place(name, src) {
  const dest = join(BIN, name)
  if (!force && (await exists(dest))) {
    console.log(`skip (exists): ${dest}`)
    return
  }
  if (!src || !(await exists(src))) {
    console.log(`⚠️ ${name}: 静的バイナリが見つかりません（src=${src}）`)
    return
  }
  await rm(dest, { force: true })
  await copyFile(src, dest)
  if (EXE === '') await chmod(dest, 0o755)
  console.log(`placed ${name} ← ${src}`)
}

// deno のリリース zip を取得し、中の単一バイナリを outPath へ展開する。
//   asset 例: deno-aarch64-apple-darwin.zip / deno-x86_64-pc-windows-msvc.zip
// 展開は Windows は tar（bsdtar が zip 対応）、その他は unzip を使う。
async function fetchDenoBinary(asset, outPath) {
  const url = `https://github.com/denoland/deno/releases/latest/download/${asset}`
  const tmpZip = `${outPath}.zip`
  const tmpDir = `${outPath}.extract`
  console.log(`download deno: ${url}`)
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} for ${url}`)
  await pipeline(res.body, createWriteStream(tmpZip))
  await mkdir(tmpDir, { recursive: true })
  if (targetOS === 'win32') await execFileP('tar', ['-xf', tmpZip, '-C', tmpDir])
  else await execFileP('unzip', ['-o', '-j', tmpZip, '-d', tmpDir])
  const inner = join(tmpDir, `deno${EXE}`)
  await rm(outPath, { force: true })
  await copyFile(inner, outPath)
  if (EXE === '') await chmod(outPath, 0o755)
  await rm(tmpZip, { force: true })
  await rm(tmpDir, { recursive: true, force: true })
}

// ffmpeg-static のリリースから指定 arch の ffmpeg を取得（.gz を展開）して返す
async function downloadFfmpeg(arch, outPath) {
  const cfg = require('ffmpeg-static/package.json')['ffmpeg-static']
  const tag = cfg['binary-release-tag']
  const url = `https://github.com/eugeneware/ffmpeg-static/releases/download/${tag}/ffmpeg-darwin-${arch}.gz`
  console.log(`download ffmpeg(${arch}): ${url}`)
  const gz = await fetchBuffer(url)
  await writeFile(outPath, gunzipSync(gz))
  await chmod(outPath, 0o755)
}

async function buildUniversalMac() {
  await mkdir(BIN, { recursive: true })

  // yt-dlp（macOS 版はユニバーサル）
  const ytDest = join(BIN, 'yt-dlp')
  await download(
    'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos',
    ytDest
  )
  if (await exists(ytDest)) await chmod(ytDest, 0o755)

  // ffmpeg: arm64 + x64 を取得して lipo でユニバーサル化（両 arch ネイティブ）
  const ffDest = join(BIN, 'ffmpeg')
  if (force || !(await exists(ffDest))) {
    const a = join(BIN, '.ffmpeg-arm64')
    const x = join(BIN, '.ffmpeg-x64')
    await downloadFfmpeg('arm64', a)
    await downloadFfmpeg('x64', x)
    await execFileP('lipo', ['-create', a, x, '-output', ffDest])
    await chmod(ffDest, 0o755)
    await rm(a, { force: true })
    await rm(x, { force: true })
    const { stdout } = await execFileP('lipo', ['-archs', ffDest])
    console.log(`ffmpeg universal archs: ${stdout.trim()}`)
  } else {
    console.log(`skip (exists): ${ffDest}`)
  }

  // ffprobe: ffprobe-static は darwin 用が x86_64（Apple Silicon では Rosetta で動作）。
  // 動画結合・音声抽出は ffmpeg のみで成立するため best-effort で同梱する。
  let ffprobeSrc = null
  try {
    ffprobeSrc = require('ffprobe-static').path
  } catch {
    console.log('⚠️ ffprobe-static が見つかりません。')
  }
  await place('ffprobe', ffprobeSrc)

  // deno: arm64 + x64 を取得して lipo でユニバーサル化（yt-dlp の JS ランタイム）
  const denoDest = join(BIN, 'deno')
  if (force || !(await exists(denoDest))) {
    const da = join(BIN, '.deno-arm64')
    const dx = join(BIN, '.deno-x64')
    await fetchDenoBinary('deno-aarch64-apple-darwin.zip', da)
    await fetchDenoBinary('deno-x86_64-apple-darwin.zip', dx)
    await execFileP('lipo', ['-create', da, dx, '-output', denoDest])
    await chmod(denoDest, 0o755)
    await rm(da, { force: true })
    await rm(dx, { force: true })
    const { stdout } = await execFileP('lipo', ['-archs', denoDest])
    console.log(`deno universal archs: ${stdout.trim()}`)
  } else {
    console.log(`skip (exists): ${denoDest}`)
  }

  console.log('\n完了（target=darwin universal）。resources/bin に yt-dlp / ffmpeg(universal) / ffprobe / deno を配置しました。')
}

async function buildForHost() {
  await mkdir(BIN, { recursive: true })

  // yt-dlp（プラットフォーム別アセット）
  const ytAsset =
    targetOS === 'win32' ? 'yt-dlp.exe' : targetOS === 'darwin' ? 'yt-dlp_macos' : 'yt-dlp_linux'
  const ytDest = join(BIN, `yt-dlp${EXE}`)
  await download(`https://github.com/yt-dlp/yt-dlp/releases/latest/download/${ytAsset}`, ytDest)
  if (EXE === '' && (await exists(ytDest))) await chmod(ytDest, 0o755)

  // ffmpeg / ffprobe（静的ビルド）を npm パッケージからコピー（host arch）
  let ffmpegSrc = null
  let ffprobeSrc = null
  try {
    ffmpegSrc = require('ffmpeg-static')
  } catch {
    console.log('⚠️ ffmpeg-static が見つかりません。`npm install` を実行してください。')
  }
  try {
    ffprobeSrc = require('ffprobe-static').path
  } catch {
    console.log('⚠️ ffprobe-static が見つかりません。`npm install` を実行してください。')
  }
  await place(`ffmpeg${EXE}`, ffmpegSrc)
  await place(`ffprobe${EXE}`, ffprobeSrc)

  // deno（host arch。yt-dlp の YouTube 抽出に使う JS ランタイム）
  const denoAsset =
    targetOS === 'win32'
      ? 'deno-x86_64-pc-windows-msvc.zip'
      : targetOS === 'darwin'
        ? process.arch === 'arm64'
          ? 'deno-aarch64-apple-darwin.zip'
          : 'deno-x86_64-apple-darwin.zip'
        : 'deno-x86_64-unknown-linux-gnu.zip'
  const denoDest = join(BIN, `deno${EXE}`)
  if (force || !(await exists(denoDest))) await fetchDenoBinary(denoAsset, denoDest)
  else console.log(`skip (exists): ${denoDest}`)

  console.log(`\n完了（target=${targetOS}）。resources/bin に yt-dlp / ffmpeg / ffprobe / deno を配置しました。`)
}

async function main() {
  if (universalMac) await buildUniversalMac()
  else await buildForHost()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
