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
