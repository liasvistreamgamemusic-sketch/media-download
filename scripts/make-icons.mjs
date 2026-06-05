#!/usr/bin/env node
// build/icon.png（高解像度マスター）から各OS用アイコンを生成する。
//   - build/icon.png  : 1024x1024（electron-builder 共通 / Linux）
//   - build/icon.icns : macOS（iconutil）
//   - build/icon.ico  : Windows（PNG 埋め込み ICO）
// 依存: sips / iconutil（macOS 同梱）。他OSでは生成済みアイコンをコミット済みのため不要。
import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile, readFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileP = promisify(execFile)
const __dirname = dirname(fileURLToPath(import.meta.url))
const BUILD = join(__dirname, '..', 'build')
const MASTER = join(BUILD, 'icon.png')

async function sipsResize(src, size, out) {
  await execFileP('sips', ['-z', String(size), String(size), src, '--out', out])
}

async function makeIcns() {
  const set = await mkdtemp(join(tmpdir(), 'iconset-'))
  const dir = join(set, 'icon.iconset')
  await mkdir(dir, { recursive: true })
  const specs = [
    [16, '16x16'],
    [32, '16x16@2x'],
    [32, '32x32'],
    [64, '32x32@2x'],
    [128, '128x128'],
    [256, '128x128@2x'],
    [256, '256x256'],
    [512, '256x256@2x'],
    [512, '512x512'],
    [1024, '512x512@2x']
  ]
  for (const [size, name] of specs) {
    await sipsResize(MASTER, size, join(dir, `icon_${name}.png`))
  }
  await execFileP('iconutil', ['-c', 'icns', dir, '-o', join(BUILD, 'icon.icns')])
  await rm(set, { recursive: true, force: true })
  console.log('wrote build/icon.icns')
}

async function makeIco() {
  const sizes = [16, 24, 32, 48, 64, 128, 256]
  const tmp = await mkdtemp(join(tmpdir(), 'ico-'))
  const images = []
  for (const s of sizes) {
    const p = join(tmp, `${s}.png`)
    await sipsResize(MASTER, s, p)
    images.push({ size: s, data: await readFile(p) })
  }
  // ICO（PNG 埋め込み, Vista+）
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type = icon
  header.writeUInt16LE(images.length, 4)
  const entries = Buffer.alloc(16 * images.length)
  let offset = 6 + 16 * images.length
  images.forEach((img, i) => {
    const e = i * 16
    entries.writeUInt8(img.size >= 256 ? 0 : img.size, e + 0) // width (0 = 256)
    entries.writeUInt8(img.size >= 256 ? 0 : img.size, e + 1) // height
    entries.writeUInt8(0, e + 2) // palette
    entries.writeUInt8(0, e + 3) // reserved
    entries.writeUInt16LE(1, e + 4) // color planes
    entries.writeUInt16LE(32, e + 6) // bits per pixel
    entries.writeUInt32LE(img.data.length, e + 8)
    entries.writeUInt32LE(offset, e + 12)
    offset += img.data.length
  })
  const ico = Buffer.concat([header, entries, ...images.map((i) => i.data)])
  await writeFile(join(BUILD, 'icon.ico'), ico)
  await rm(tmp, { recursive: true, force: true })
  console.log(`wrote build/icon.ico (${images.length} sizes)`)
}

async function main() {
  // マスターを 1024 に正規化（electron-builder は 1024 を想定）
  await sipsResize(MASTER, 1024, MASTER)
  await makeIcns()
  await makeIco()
  console.log('done')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
