import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defaultBinDir, ENV, exeName, resolveBinaries } from './binaries.js'
import { MediaDownloadError } from './errors.js'

describe('resolveBinaries', () => {
  let root: string
  const touch = async (dir: string, name: string): Promise<string> => {
    await mkdir(dir, { recursive: true })
    const p = join(dir, exeName(name))
    await writeFile(p, '')
    return p
  }

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'mdl-bin-'))
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('prefers explicit options over env, binDir and PATH', async () => {
    const explicit = await touch(join(root, 'explicit'), 'yt-dlp')
    const envBin = await touch(join(root, 'env'), 'yt-dlp')
    await touch(join(root, 'cache'), 'yt-dlp')
    const ff = join(root, 'ff')
    await touch(ff, 'ffmpeg')
    const r = resolveBinaries(
      { ytDlp: explicit, ffmpegDir: ff, binDir: join(root, 'cache') },
      { [ENV.YT_DLP]: envBin, PATH: '' }
    )
    expect(r.ytDlp).toBe(explicit)
    expect(r.ffmpegDir).toBe(ff)
  })

  it('uses env vars when no option is given', async () => {
    const envBin = await touch(join(root, 'env'), 'yt-dlp')
    const deno = await touch(join(root, 'env'), 'deno')
    const r = resolveBinaries({ binDir: join(root, 'cache') }, { [ENV.YT_DLP]: envBin, [ENV.DENO]: deno, PATH: '' })
    expect(r.ytDlp).toBe(envBin)
    expect(r.deno).toBe(deno)
  })

  it('uses binDir (setup target) before PATH, including deno', async () => {
    const cache = join(root, 'cache')
    const cached = await touch(cache, 'yt-dlp')
    await touch(cache, 'ffmpeg')
    const deno = await touch(cache, 'deno')
    const onPath = join(root, 'path')
    await touch(onPath, 'yt-dlp')
    const r = resolveBinaries({}, { [ENV.BIN_DIR]: cache, PATH: onPath })
    expect(r).toEqual({ ytDlp: cached, ffmpegDir: cache, deno })
  })

  it('falls back to PATH; deno on PATH is left to yt-dlp itself', async () => {
    const onPath = join(root, 'path')
    const yt = await touch(onPath, 'yt-dlp')
    await touch(onPath, 'deno')
    const r = resolveBinaries({ binDir: join(root, 'empty') }, { PATH: onPath })
    expect(r.ytDlp).toBe(yt)
    expect(r.deno).toBeUndefined()
  })

  it('throws ENGINE_MISSING with setup guidance when yt-dlp is nowhere', () => {
    let err: unknown
    try {
      resolveBinaries({ binDir: join(root, 'empty') }, { PATH: '' })
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(MediaDownloadError)
    expect((err as MediaDownloadError).code).toBe('ENGINE_MISSING')
    expect((err as MediaDownloadError).message).toContain('media-dl setup')
  })

  it('does not silently fall back when an explicit path is wrong', async () => {
    await touch(join(root, 'path'), 'yt-dlp')
    expect(() => resolveBinaries({ ytDlp: join(root, 'nope') }, { PATH: join(root, 'path') })).toThrow(MediaDownloadError)
    const yt = await touch(join(root, 'x'), 'yt-dlp')
    let err: unknown
    try {
      resolveBinaries({ ytDlp: yt, ffmpegDir: join(root, 'nope') }, { PATH: '' })
    } catch (e) {
      err = e
    }
    expect((err as MediaDownloadError).code).toBe('FFMPEG_MISSING')
  })
})

describe('defaultBinDir', () => {
  it('follows each OS cache convention', () => {
    expect(defaultBinDir({ LOCALAPPDATA: 'C:\\L' }, 'win32')).toBe(join('C:\\L', 'media-dl', 'bin'))
    expect(defaultBinDir({ XDG_CACHE_HOME: '/xdg' }, 'linux')).toBe(join('/xdg', 'media-dl', 'bin'))
    expect(defaultBinDir({}, 'darwin')).toMatch(/Library[/\\]Caches[/\\]media-dl[/\\]bin$/)
  })
})
