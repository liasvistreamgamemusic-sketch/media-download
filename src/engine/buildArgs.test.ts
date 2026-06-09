import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { buildDownloadArgs, buildProbeArgs, PROGRESS_TEMPLATE, OUTPUT_TEMPLATE } from './buildArgs'
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

  it('audio_lossless: ba/b, -x to remux into a thumbnail-capable container, no re-encode', () => {
    const args = buildDownloadArgs({ ...base, kind: 'audio_lossless' }, paths)
    expect(args[args.indexOf('-f') + 1]).toBe('ba/b')
    expect(args).toContain('-x') // .webm はサムネ埋め込み非対応 → -x で opus/m4a 等へリマックス
    expect(args).not.toContain('--audio-format') // --audio-format なし＝再エンコードしない
  })

  it('audio_lossless + addToAppleMusic: converts to ALAC (.m4a) for Apple compatibility', () => {
    const args = buildDownloadArgs({ ...base, kind: 'audio_lossless', addToAppleMusic: true }, paths)
    expect(args).toContain('-x')
    expect(args[args.indexOf('--audio-format') + 1]).toBe('alac')
  })

  it('audio_lossless without addToAppleMusic: keeps original codec (no --audio-format)', () => {
    const args = buildDownloadArgs({ ...base, kind: 'audio_lossless' }, paths)
    expect(args).not.toContain('--audio-format')
  })

  it('passes --js-runtimes deno:<path> only when deno is bundled', () => {
    const without = buildDownloadArgs(base, paths)
    expect(without).not.toContain('--js-runtimes')

    const withDeno = buildDownloadArgs(base, { ...paths, deno: '/bin/deno' })
    expect(withDeno).toContain('--js-runtimes')
    expect(withDeno[withDeno.indexOf('--js-runtimes') + 1]).toBe('deno:/bin/deno')
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

  it('writes the final path to a UTF-8 file via --print-to-file when printPathFile is given', () => {
    const args = buildDownloadArgs(base, paths, '/out/.tmp', '/out/.tmp/filepath.txt')
    const i = args.indexOf('--print-to-file')
    expect(i).toBeGreaterThan(-1)
    expect(args[i + 1]).toBe('after_move:filepath')
    expect(args[i + 2]).toBe('/out/.tmp/filepath.txt')
  })

  it('omits --print-to-file when no printPathFile is given', () => {
    expect(buildDownloadArgs(base, paths, '/out/.tmp')).not.toContain('--print-to-file')
  })

  it('without tempDir: absolute -o, no -P (current behavior)', () => {
    const args = buildDownloadArgs(base, paths)
    expect(args).not.toContain('-P')
    const out = args[args.indexOf('-o') + 1]
    // path.join はプラットフォーム依存（Windows は \ 区切り）なので join 同士で比較する
    expect(out).toBe(path.join('/out', OUTPUT_TEMPLATE))
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

  it('passes --js-runtimes deno:<path> only when deno path is provided', () => {
    expect(buildProbeArgs('https://x/y')).not.toContain('--js-runtimes')
    const args = buildProbeArgs('https://x/y', false, '/bin/deno')
    expect(args[args.indexOf('--js-runtimes') + 1]).toBe('deno:/bin/deno')
  })
})
