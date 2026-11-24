import { describe, it, expect } from 'vitest'
import { DownloadRequestSchema, migrateSettings, SettingsSchema } from './schemas'

const v14 = {
  outputDir: '/Users/a/Downloads',
  defaultKind: 'audio_mp3',
  embedMetadata: true,
  embedThumbnail: false,
  disclaimerAccepted: true,
  cookiesFromBrowser: 'edge',
  addToAppleMusic: true,
  itunesAutoAddDir: null
}

describe('migrateSettings', () => {
  it('maps v1.4 defaultKind to defaultFormat and keeps every other value', () => {
    const s = SettingsSchema.parse(migrateSettings(v14))
    expect(s).toStrictEqual({
      outputDir: '/Users/a/Downloads',
      defaultFormat: 'mp3',
      embedMetadata: true,
      embedThumbnail: false,
      disclaimerAccepted: true,
      cookiesFromBrowser: 'edge',
      addToAppleMusic: true,
      itunesAutoAddDir: null
    })
  })

  it.each([
    ['video_best', 'mp4'],
    ['audio_lossless', 'audio']
  ])('%s → %s', (kind, format) => {
    expect(SettingsSchema.parse(migrateSettings({ ...v14, defaultKind: kind })).defaultFormat).toBe(format)
  })

  it('prefers an existing defaultFormat and tolerates non-objects', () => {
    expect(SettingsSchema.parse(migrateSettings({ ...v14, defaultFormat: 'flac' })).defaultFormat).toBe('flac')
    expect(migrateSettings(undefined)).toBeUndefined()
  })
})

describe('DownloadRequestSchema', () => {
  it('accepts core spec fields plus Apple Music fields', () => {
    const r = DownloadRequestSchema.parse({
      url: 'https://e/x',
      outputDir: '/o',
      format: 'alac',
      addToAppleMusic: true,
      itunesAutoAddDir: null
    })
    expect(r.format).toBe('alac')
  })

  it('rejects non-http URLs and unknown formats', () => {
    expect(() => DownloadRequestSchema.parse({ url: 'file:///x', outputDir: '/o' })).toThrow()
    expect(() => DownloadRequestSchema.parse({ url: 'https://e/x', outputDir: '/o', format: 'gif' })).toThrow()
  })
})
