import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { MediaDownloader } from './MediaDownloader.js'
import { MediaDownloadError } from './errors.js'
import type { DownloadProgress } from './types.js'

// 偽 yt-dlp は shebang 付きスクリプトのため、Windows では直接実行できない（実行ファイルとして扱われない）
const FAKE = resolve(__dirname, '..', 'test', 'fake', 'yt-dlp')
const posixOnly = process.platform === 'win32' ? describe.skip : describe

posixOnly('MediaDownloader（偽 yt-dlp による結合テスト）', () => {
  let out: string
  let ffDir: string
  let dl: MediaDownloader

  beforeEach(async () => {
    out = await mkdtemp(join(tmpdir(), 'mdl-test-'))
    // ffmpegDir は存在チェックのみ（偽 yt-dlp は ffmpeg を呼ばない）ので空ファイルで足りる
    ffDir = await mkdtemp(join(tmpdir(), 'mdl-ff-'))
    await writeFile(join(ffDir, 'ffmpeg'), '')
    dl = new MediaDownloader({ ytDlp: FAKE, ffmpegDir: ffDir })
  })
  afterEach(async () => {
    await rm(out, { recursive: true, force: true })
    await rm(ffDir, { recursive: true, force: true })
  })

  const tempDirsLeft = async (): Promise<string[]> =>
    (await readdir(out)).filter((n) => n.startsWith('.mdl-tmp-'))

  it('returns the absolute final path (UTF-8) and removes the temp dir', async () => {
    const progress: DownloadProgress[] = []
    const r = await dl.download({ url: 'https://ok/', outputDir: out, onProgress: (p) => progress.push(p) })
    expect(r.files).toEqual([join(out, 'Fake 日本語 [x1].mp4')])
    expect(existsSync(r.files[0])).toBe(true)
    expect(r.warnings).toEqual([])
    expect(progress.map((p) => p.status)).toEqual(['downloading', 'postprocessing'])
    expect(await tempDirsLeft()).toEqual([])
  })

  it('creates a missing output directory', async () => {
    const nested = join(out, 'a', 'b')
    const r = await dl.download({ url: 'https://ok/', outputDir: nested, format: 'mkv' })
    expect(r.files).toEqual([join(nested, 'Fake 日本語 [x1].mkv')])
  })

  it('returns every file of a playlist', async () => {
    const r = await dl.download({ url: 'https://playlist/', outputDir: out, format: 'mp3', playlist: true })
    expect(r.files).toEqual([join(out, 'one [a].mp3'), join(out, 'two [b].mp3')])
  })

  it('classifies yt-dlp errors and leaves no fragments', async () => {
    const err = await dl.download({ url: 'https://fail/', outputDir: out }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(MediaDownloadError)
    expect((err as MediaDownloadError).code).toBe('UNSUPPORTED_URL')
    expect(await tempDirsLeft()).toEqual([])
  })

  it('cancels via AbortSignal, kills the process and cleans up', async () => {
    const ac = new AbortController()
    const p = dl.download({
      url: 'https://hang/',
      outputDir: out,
      signal: ac.signal,
      onProgress: () => ac.abort()
    })
    const err = await p.catch((e: unknown) => e)
    expect((err as MediaDownloadError).code).toBe('CANCELLED')
    expect(await tempDirsLeft()).toEqual([])
  })

  it('rejects an already-aborted signal without starting', async () => {
    const ac = new AbortController()
    ac.abort()
    const err = await dl.download({ url: 'https://ok/', outputDir: out, signal: ac.signal }).catch((e: unknown) => e)
    expect((err as MediaDownloadError).code).toBe('CANCELLED')
    expect(await readdir(out)).toEqual([])
  })

  it('validates input before running anything', async () => {
    const bad = await dl.download({ url: 'file:///etc/passwd', outputDir: out }).catch((e: unknown) => e)
    expect((bad as MediaDownloadError).code).toBe('INVALID_INPUT')
    const traversal = await dl
      .download({ url: 'https://ok/', outputDir: out, filenameTemplate: '../%(title)s.%(ext)s' })
      .catch((e: unknown) => e)
    expect((traversal as MediaDownloadError).code).toBe('INVALID_INPUT')
  })

  it('probe parses JSON into MediaInfo', async () => {
    const info = await dl.probe('https://ok/')
    expect(info.title).toBe('Fake')
    expect(info.hasVideo).toBe(true)
  })

  it('engineVersion runs yt-dlp --version', async () => {
    expect(await dl.engineVersion()).toBe('2099.01.01-fake')
  })
})
