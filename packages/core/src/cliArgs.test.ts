import { describe, it, expect } from 'vitest'
import { parseCliArgs, UsageError } from './cliArgs.js'

describe('parseCliArgs', () => {
  it('treats bare URLs as download with sane defaults', () => {
    const c = parseCliArgs(['https://a/1', 'https://b/2'])
    expect(c).toMatchObject({
      kind: 'download',
      urls: ['https://a/1', 'https://b/2'],
      json: false,
      quiet: false,
      spec: { outputDir: '.', playlist: false, embedMetadata: true, embedThumbnail: true, subtitles: false }
    })
    if (c.kind === 'download') expect(c.spec.metadata).toBeUndefined()
  })

  it('parses download options', () => {
    const c = parseCliArgs([
      'download',
      'https://a/1',
      '-f', 'mp3',
      '-o', 'out',
      '-n', '%(title)s.%(ext)s',
      '-s', 'ba[abr>128]',
      '--playlist',
      '--no-metadata',
      '--no-thumbnail',
      '--subs',
      '--cookies-from-browser', 'firefox',
      '--cookies', 'c.txt',
      '--artist', 'A',
      '--json',
      '--bin-dir', '/bins'
    ])
    expect(c).toEqual({
      kind: 'download',
      urls: ['https://a/1'],
      json: true,
      quiet: false,
      binDir: '/bins',
      spec: {
        outputDir: 'out',
        format: 'mp3',
        filenameTemplate: '%(title)s.%(ext)s',
        formatSelector: 'ba[abr>128]',
        playlist: true,
        embedMetadata: false,
        embedThumbnail: false,
        subtitles: true,
        cookiesFromBrowser: 'firefox',
        cookiesFile: 'c.txt',
        metadata: { artist: 'A' }
      }
    })
  })

  it('parses subcommands', () => {
    expect(parseCliArgs(['formats'])).toEqual({ kind: 'formats' })
    expect(parseCliArgs(['setup', '--force'])).toEqual({ kind: 'setup', force: true, binDir: undefined })
    expect(parseCliArgs(['update'])).toEqual({ kind: 'update', binDir: undefined })
    expect(parseCliArgs(['info', 'https://a/1', '--json'])).toMatchObject({ kind: 'info', url: 'https://a/1', json: true })
    expect(parseCliArgs(['-h'])).toEqual({ kind: 'help' })
    expect(parseCliArgs(['--version'])).toEqual({ kind: 'version' })
  })

  it('rejects invalid usage', () => {
    expect(() => parseCliArgs([])).toThrow(UsageError)
    expect(() => parseCliArgs(['https://a/1', '-f', 'gif'])).toThrow(/未対応の出力形式/)
    expect(() => parseCliArgs(['https://a/1', '--cookies-from-browser', 'netscape'])).toThrow(UsageError)
    expect(() => parseCliArgs(['https://a/1', '--unknown'])).toThrow(UsageError)
    expect(() => parseCliArgs(['info'])).toThrow(UsageError)
  })
})
