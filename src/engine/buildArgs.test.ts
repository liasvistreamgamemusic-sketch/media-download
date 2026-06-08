import { describe, it, expect } from 'vitest'
import { buildDownloadArgs, buildProbeArgs, PROGRESS_TEMPLATE } from './buildArgs'
import type { BinPaths, DownloadRequest } from '../shared/types'

const paths: BinPaths = { ytDlp: '/bin/yt-dlp', ffmpegDir: '/bin' }

const base: DownloadRequest = {
  url: 'https://example.com/v',
  kind: 'audio_lossless',
  outputDir: '/out'
}

describe('buildDownloadArgs', () => {
  it('NEVER includes --restrict-filenames, but uses --windows-filenames', () => {
    const args = buildDownloadArgs(base, paths)
    expect(args).not.toContain('--restrict-filenames')
    expect(args).toContain('--windows-filenames')
  })

  it('terminates args with -- before the URL', () => {
    const args = buildDownloadArgs(base, paths)
    expect(args[args.length - 2]).toBe('--')
    expect(args[args.length - 1]).toBe('https://example.com/v')
  })

  it('does not interpolate the URL into any other arg', () => {
    const req = { ...base, url: 'https://evil/?x=--foo' }
    const args = buildDownloadArgs(req, paths)
    // URL は最後の要素にだけ存在する
    expect(args.filter((a) => a.includes('evil'))).toEqual(['https://evil/?x=--foo'])
  })

  it('uses --ignore-config and machine-readable progress template', () => {
    const args = buildDownloadArgs(base, paths)
    expect(args).toContain('--ignore-config')
    expect(args).toContain('--progress-template')
    expect(args[args.indexOf('--progress-template') + 1]).toBe(PROGRESS_TEMPLATE)
  })

  it('passes ffmpeg-location dir', () => {
    const args = buildDownloadArgs(base, paths)
    expect(args[args.indexOf('--ffmpeg-location') + 1]).toBe('/bin')
  })

  it('video_best: bv*+ba/b + merge mp4 by default', () => {
    const args = buildDownloadArgs({ ...base, kind: 'video_best' }, paths)
    expect(args[args.indexOf('-f') + 1]).toBe('bv*+ba/b')
    expect(args).toContain('--merge-output-format')
    expect(args[args.indexOf('--merge-output-format') + 1]).toBe('mp4')
  })

  it('video_best: explicit formatId overrides default', () => {
    const args = buildDownloadArgs({ ...base, kind: 'video_best', formatId: '137+140' }, paths)
    expect(args[args.indexOf('-f') + 1]).toBe('137+140')
  })

  it('audio_mp3: extract + mp3 + best quality', () => {
    const args = buildDownloadArgs({ ...base, kind: 'audio_mp3' }, paths)
    expect(args).toContain('-x')
    expect(args[args.indexOf('--audio-format') + 1]).toBe('mp3')
    expect(args[args.indexOf('--audio-quality') + 1]).toBe('0')
  })

  it('audio_mp3: forces audio-only format so video stream is never fetched', () => {
    const args = buildDownloadArgs({ ...base, kind: 'audio_mp3' }, paths)
    // -f が音声のみ（ba/b）。これが無いと既定の bv*+ba/b で映像も取りに行き失敗する。
    expect(args[args.indexOf('-f') + 1]).toBe('ba/b')
    expect(args).not.toContain('bv*+ba/b')
  })

  it('audio_mp3: explicit formatId overrides the default audio selector', () => {
    const args = buildDownloadArgs({ ...base, kind: 'audio_mp3', formatId: '251' }, paths)
    expect(args[args.indexOf('-f') + 1]).toBe('251')
    expect(args).toContain('-x')
  })

  it('audio_lossless: ba/b, no re-encode flags', () => {
    const args = buildDownloadArgs({ ...base, kind: 'audio_lossless' }, paths)
    expect(args[args.indexOf('-f') + 1]).toBe('ba/b')
    expect(args).not.toContain('--audio-format')
  })

  it('toggles optional flags only when requested', () => {
    const off = buildDownloadArgs(base, paths)
    expect(off).not.toContain('--embed-metadata')
    expect(off).not.toContain('--no-playlist')
    expect(off).not.toContain('--cookies-from-browser')

    const on = buildDownloadArgs(
      {
        ...base,
        embedMetadata: true,
        embedThumbnail: true,
        writeSubs: true,
        noPlaylist: true,
        cookiesFromBrowser: 'chrome'
      },
      paths
    )
    expect(on).toContain('--embed-metadata')
    expect(on).toContain('--embed-thumbnail')
    expect(on).toContain('--write-subs')
    expect(on[on.indexOf('--sub-langs') + 1]).toBe('all')
    expect(on).toContain('--no-playlist')
    expect(on[on.indexOf('--cookies-from-browser') + 1]).toBe('chrome')
  })

  it('output template restricts title length and adds id', () => {
    const args = buildDownloadArgs(base, paths)
    const out = args[args.indexOf('-o') + 1]
    expect(out).toContain('%(title).150B')
    expect(out).toContain('%(id)s')
  })

  it('without tempDir: absolute -o, no -P (current behavior)', () => {
    const args = buildDownloadArgs(base, paths)
    expect(args).not.toContain('-P')
    const out = args[args.indexOf('-o') + 1]
    expect(out.startsWith('/out')).toBe(true)
  })

  it('with tempDir: isolates intermediate files via -P, relative -o', () => {
    const args = buildDownloadArgs(base, paths, '/out/.mdl-tmp-123')
    // -P は -o が絶対だと無視されるため、-o は相対テンプレートでなければならない
    const out = args[args.indexOf('-o') + 1]
    expect(out).toBe('%(title).150B [%(id)s].%(ext)s')
    // home=出力先 / temp=隔離先
    const pIdxs = args.reduce<number[]>((acc, a, i) => (a === '-P' ? [...acc, i] : acc), [])
    const pValues = pIdxs.map((i) => args[i + 1])
    expect(pValues).toContain('home:/out')
    expect(pValues).toContain('temp:/out/.mdl-tmp-123')
  })
})

describe('buildProbeArgs', () => {
  it('uses dump-single-json and terminates with --', () => {
    const args = buildProbeArgs('https://x/y')
    expect(args).toContain('--dump-single-json')
    expect(args).toContain('--no-playlist')
    expect(args[args.length - 2]).toBe('--')
    expect(args[args.length - 1]).toBe('https://x/y')
  })

  it('flat mode uses --flat-playlist', () => {
    const args = buildProbeArgs('https://x/y', true)
    expect(args).toContain('--flat-playlist')
    expect(args).not.toContain('--no-playlist')
  })
})
