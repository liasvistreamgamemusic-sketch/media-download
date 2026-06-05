#!/usr/bin/env node
// resources/bin に yt-dlp / ffmpeg / ffprobe を配置する。
//   - yt-dlp        : GitHub releases から現プラットフォーム版を取得
//   - ffmpeg/ffprobe: ffmpeg-static / ffprobe-static（静的ビルド）からコピー
// すべて静的バイナリのため配布パッケージにそのまま同梱できる（Homebrew 非依存）。
// 既存はスキップ。--force で上書き。
import { createRequire } from 'node:module'
import { mkdir, chmod, access, rm, copyFile } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const __dirname = dirname(fileURLToPath(import.meta.url))
const BIN = join(__dirname, '..', 'resources', 'bin')
const force = process.argv.includes('--force')
const targetOS = process.argv.find((a) => a.startsWith('--os='))?.slice(5) ?? process.platform
const EXE = targetOS === 'win32' ? '.exe' : ''

const exists = (p) =>
  access(p)
    .then(() => true)
    .catch(() => false)

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

async function main() {
  await mkdir(BIN, { recursive: true })

  // 1) yt-dlp（プラットフォーム別アセット）
  const ytAsset =
    targetOS === 'win32' ? 'yt-dlp.exe' : targetOS === 'darwin' ? 'yt-dlp_macos' : 'yt-dlp_linux'
  const ytDest = join(BIN, `yt-dlp${EXE}`)
  await download(`https://github.com/yt-dlp/yt-dlp/releases/latest/download/${ytAsset}`, ytDest)
  if (EXE === '' && (await exists(ytDest))) await chmod(ytDest, 0o755)

  // 2) ffmpeg / ffprobe（静的ビルド）を npm パッケージからコピー
  //    各ランナーはネイティブ arch 版を取得する（CI のマトリクスで arm64/x64/win を分担）。
  let ffmpegSrc = null
  let ffprobeSrc = null
  try {
    ffmpegSrc = require('ffmpeg-static') // パス文字列
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

  console.log(`\n完了（target=${targetOS}）。resources/bin に yt-dlp / ffmpeg / ffprobe を配置しました。`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
