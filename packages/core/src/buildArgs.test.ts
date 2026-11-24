import { describe, it, expect } from 'vitest'
import { buildDownloadArgs, buildProbeArgs, PROGRESS_TEMPLATE, OUTPUT_TEMPLATE } from './buildArgs.js'
import { OUTPUT_FORMATS } from './formats.js'
import type { BinPaths, DownloadSpec } from './types.js'

const paths: BinPaths = { ytDlp: '/bin/yt-dlp', ffmpegDir: '/bin' }
const TEMP = '/out/.mdl-tmp-123'
const PRINT = '/out/.mdl-tmp-123/.mdl-filepath.txt'

const base: DownloadSpec = { url: 'https://example.com/v', outputDir: '/out' }

const build = (spec: Partial<DownloadSpec> = {}, p: BinPaths = paths): string[] =>
  buildDownloadArgs({ ...base, ...spec }, p, TEMP, PRINT)

const valueOf = (args: string[], flag: string): string | undefined => {
  const i = args.indexOf(flag)
  return i >= 0 ? args[i + 1] : undefined
}

describe('buildDownloadArgs: 共通', () => {
  it('NEVER includes --restrict-filenames, but uses --windows-filenames', () => {
    const args = build()
    expect(args).not.toContain('--restrict-filenames')
    expect(args).toContain('--windows-filenames')
  })

  it('terminates args with -- before the URL', () => {
    const args = build()
    expect(args.slice(-2)).toEqual(['--', 'https://example.com/v'])
  })

  it('does not interpolate the URL into any other arg', () => {
    const args = build({ url: 'https://evil/?x=--foo' })
    expect(args.filter((a) => a.includes('evil'))).toEqual(['https://evil/?x=--foo'])
  })

  it('uses --ignore-config and machine-readable progress template', () => {
    const args = build()
    expect(args).toContain('--ignore-config')
    expect(valueOf(args, '--progress-template')).toBe(PROGRESS_TEMPLATE)
  })

  it('passes ffmpeg-location dir only when ffmpeg is resolved', () => {
    expect(valueOf(build(), '--ffmpeg-location')).toBe('/bin')
    expect(build({}, { ...paths, ffmpegDir: null })).not.toContain('--ffmpeg-location')
  })

  it('passes --js-runtimes deno:<path> only when deno is given', () => {
    expect(build()).not.toContain('--js-runtimes')
    expect(valueOf(build({}, { ...paths, deno: '/bin/deno' }), '--js-runtimes')).toBe('deno:/bin/deno')
  })

  it('writes final paths to a UTF-8 file via --print-to-file', () => {
    const args = build()
    const i = args.indexOf('--print-to-file')
    expect(args.slice(i + 1, i + 3)).toEqual(['after_move:filepath', PRINT])
  })

  it('isolates intermediate files via -P home/temp with a relative -o', () => {
    const args = build()
    // -P は -o が絶対だと無視されるため、-o は相対テンプレートでなければならない
    expect(valueOf(args, '-o')).toBe(OUTPUT_TEMPLATE)
    const pValues = args.flatMap((a, i) => (a === '-P' ? [args[i + 1]] : []))
    expect(pValues).toEqual(['home:/out', `temp:${TEMP}`])
  })

  it('output template restricts title length and adds id', () => {
    const out = valueOf(build(), '-o')
    expect(out).toContain('%(title).150B')
    expect(out).toContain('%(id)s')
  })

  it('custom filename template replaces the default', () => {
    expect(valueOf(build({ filenameTemplate: '%(title)s.%(ext)s' }), '-o')).toBe('%(title)s.%(ext)s')
  })

  it('embeds metadata and thumbnail by default; single item only by default', () => {
    const args = build()
    expect(args).toContain('--embed-metadata')
    expect(args).toContain('--embed-thumbnail')
    expect(args).toContain('--no-playlist')
    expect(args).not.toContain('--write-subs')
    expect(args).not.toContain('--cookies-from-browser')
    expect(args).not.toContain('--cookies')
  })

  it('toggles optional flags when requested', () => {
    const args = build({
      embedMetadata: false,
      embedThumbnail: false,
      subtitles: true,
      playlist: true,
      cookiesFromBrowser: 'chrome',
      cookiesFile: '/c.txt'
    })
    expect(args).not.toContain('--embed-metadata')
    expect(args).not.toContain('--embed-thumbnail')
    expect(args).not.toContain('--no-playlist')
    expect(args).toContain('--write-subs')
    expect(valueOf(args, '--sub-langs')).toBe('all')
    expect(valueOf(args, '--cookies-from-browser')).toBe('chrome')
    expect(valueOf(args, '--cookies')).toBe('/c.txt')
  })

  it('explicit formatSelector overrides the default selector of any format', () => {
    expect(valueOf(build({ format: 'mp4', formatSelector: '137+140' }), '-f')).toBe('137+140')
    const audio = build({ format: 'mp3', formatSelector: '251' })
    expect(valueOf(audio, '-f')).toBe('251')
    expect(audio).toContain('-x')
  })

  it('every output format yields a selector (sanity)', () => {
    for (const f of OUTPUT_FORMATS) expect(valueOf(build({ format: f }), '-f')).toBeTruthy()
  })
})

describe('buildDownloadArgs: 形式ごと', () => {
  it('default (mp4): bv*+ba/b, merge + remux into mp4', () => {
    const args = build()
    expect(valueOf(args, '-f')).toBe('bv*+ba/b')
    expect(valueOf(args, '--merge-output-format')).toBe('mp4')
    expect(valueOf(args, '--remux-video')).toBe('mp4')
  })

  it.each(['mkv'] as const)('%s: merge + remux into the container', (f) => {
    const args = build({ format: f })
    expect(valueOf(args, '--merge-output-format')).toBe(f)
    expect(valueOf(args, '--remux-video')).toBe(f)
  })

  it('webm: prefers webm streams, falls back to mkv merge then re-encodes to webm, no thumbnail', () => {
    const args = build({ format: 'webm' })
    expect(valueOf(args, '-f')).toMatch(/^bv\*\[ext=webm\]\+ba\[ext=webm\]/)
    expect(valueOf(args, '--merge-output-format')).toBe('webm/mkv')
    expect(valueOf(args, '--recode-video')).toBe('webm')
    // webm は --embed-thumbnail 非対応（指定すると後処理で失敗する）
    expect(args).not.toContain('--embed-thumbnail')
  })

  it('best: no container forcing and no thumbnail embedding', () => {
    const args = build({ format: 'best' })
    expect(valueOf(args, '-f')).toBe('bv*+ba/b')
    expect(args).not.toContain('--merge-output-format')
    expect(args).not.toContain('--remux-video')
    expect(args).not.toContain('--embed-thumbnail')
  })

  it.each(['mp3', 'm4a', 'opus'] as const)('%s: audio-only selector, extract + convert at best VBR', (f) => {
    const args = build({ format: f })
    // -f が音声のみ（ba/b）。これが無いと映像も取りに行き失敗する。
    expect(valueOf(args, '-f')).toBe('ba/b')
    expect(args).toContain('-x')
    expect(valueOf(args, '--audio-format')).toBe(f)
    expect(valueOf(args, '--audio-quality')).toBe('0')
  })

  it.each(['flac', 'wav', 'alac'] as const)('%s: lossless conversion without a quality flag', (f) => {
    const args = build({ format: f })
    expect(valueOf(args, '-f')).toBe('ba/b')
    expect(valueOf(args, '--audio-format')).toBe(f)
    expect(args).not.toContain('--audio-quality')
  })

  it('alac: forces the ALAC encoder (yt-dlp drops -acodec alac otherwise)', () => {
    expect(valueOf(build({ format: 'alac' }), '--postprocessor-args')).toBe('ExtractAudio:-c:a alac')
  })

  it('wav: no thumbnail embedding (unsupported container)', () => {
    expect(build({ format: 'wav' })).not.toContain('--embed-thumbnail')
  })

  it('audio: -x remuxes to an audio container without re-encoding', () => {
    const args = build({ format: 'audio' })
    expect(valueOf(args, '-f')).toBe('ba/b')
    expect(args).toContain('-x') // .webm はサムネ埋め込み非対応 → -x で opus/m4a 等へリマックス
    expect(args).not.toContain('--audio-format')
    expect(args).toContain('--embed-thumbnail')
  })
})

describe('buildProbeArgs', () => {
  it('uses dump-single-json and terminates with --', () => {
    const args = buildProbeArgs('https://x/y')
    expect(args).toContain('--dump-single-json')
    expect(args).toContain('--no-playlist')
    expect(args.slice(-2)).toEqual(['--', 'https://x/y'])
  })

  it('flat mode uses --flat-playlist', () => {
    const args = buildProbeArgs('https://x/y', { flat: true })
    expect(args).toContain('--flat-playlist')
    expect(args).not.toContain('--no-playlist')
  })

  it('passes deno and cookies when given', () => {
    expect(buildProbeArgs('https://x/y')).not.toContain('--js-runtimes')
    const args = buildProbeArgs('https://x/y', { deno: '/bin/deno', cookiesFromBrowser: 'firefox', cookiesFile: '/c.txt' })
    expect(valueOf(args, '--js-runtimes')).toBe('deno:/bin/deno')
    expect(valueOf(args, '--cookies-from-browser')).toBe('firefox')
    expect(valueOf(args, '--cookies')).toBe('/c.txt')
  })
})
