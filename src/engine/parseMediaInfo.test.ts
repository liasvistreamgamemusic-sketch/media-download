import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseMediaInfo } from './parseMediaInfo'

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(join(__dirname, '..', '..', 'test', 'fixtures', name), 'utf8'))

describe('parseMediaInfo', () => {
  it('YouTube: has both video and audio', () => {
    const info = parseMediaInfo(fixture('youtube.json'))
    expect(info.id).toBeTruthy()
    expect(info.title).toBeTruthy()
    expect(info.hasVideo).toBe(true)
    expect(info.hasAudio).toBe(true)
    expect(info.formats.length).toBeGreaterThan(0)
    expect(info.isPlaylist).toBe(false)
    expect(info.webpageUrl).toMatch(/^https?:\/\//)
  })

  it('SoundCloud: audio-only → hasVideo false, hasAudio true', () => {
    const info = parseMediaInfo(fixture('soundcloud.json'))
    expect(info.hasVideo).toBe(false) // ← capability ベース UI 適応の肝
    expect(info.hasAudio).toBe(true)
    expect(info.formats.every((f) => !f.isVideo)).toBe(true)
  })

  it('Playlist: isPlaylist true and counts entries', () => {
    const info = parseMediaInfo(fixture('playlist.json'))
    expect(info.isPlaylist).toBe(true)
    expect(info.playlistCount).toBeGreaterThan(0)
  })

  it('derives resolution from width/height', () => {
    const info = parseMediaInfo({
      id: 'x',
      title: 't',
      webpage_url: 'https://e/x',
      extractor: 'test',
      formats: [
        { format_id: '1', ext: 'mp4', vcodec: 'avc1', acodec: 'none', width: 1920, height: 1080 },
        { format_id: '2', ext: 'm4a', vcodec: 'none', acodec: 'mp4a' }
      ]
    })
    expect(info.formats[0].resolution).toBe('1920x1080')
    expect(info.formats[0].isVideo).toBe(true)
    expect(info.formats[0].isAudio).toBe(false)
    expect(info.formats[1].resolution).toBeNull()
    expect(info.formats[1].isAudio).toBe(true)
  })

  it('treats vcodec "none" as no video', () => {
    const info = parseMediaInfo({
      id: 'x',
      title: 't',
      webpage_url: 'https://e/x',
      extractor: 'test',
      formats: [{ format_id: '1', ext: 'm4a', vcodec: 'none', acodec: 'mp4a' }]
    })
    expect(info.hasVideo).toBe(false)
    expect(info.hasAudio).toBe(true)
  })

  it('prefills artist/album/description from raw fields (with creator fallback)', () => {
    const info = parseMediaInfo({
      id: 'x',
      title: 't',
      creator: 'Some Creator',
      album: 'My Album',
      description: 'hello\nworld',
      webpage_url: 'https://e/x',
      extractor: 'test',
      formats: [{ format_id: '1', ext: 'm4a', vcodec: 'none', acodec: 'mp4a' }]
    })
    expect(info.artist).toBe('Some Creator') // artist 欠落時は creator にフォールバック
    expect(info.album).toBe('My Album')
    expect(info.description).toBe('hello\nworld')
  })

  it('artist prefers raw.artist over creator; null when absent', () => {
    const withArtist = parseMediaInfo({
      id: 'x',
      title: 't',
      artist: 'The Artist',
      creator: 'ignored',
      webpage_url: 'https://e/x',
      extractor: 'test',
      formats: []
    })
    expect(withArtist.artist).toBe('The Artist')

    const none = parseMediaInfo({
      id: 'x',
      title: 't',
      webpage_url: 'https://e/x',
      extractor: 'test',
      formats: []
    })
    expect(none.artist).toBeNull()
    expect(none.album).toBeNull()
    expect(none.description).toBeNull()
  })

  it('coerces numeric id/format_id to string', () => {
    const info = parseMediaInfo({
      id: 12345,
      title: 't',
      webpage_url: 'https://e/x',
      extractor: 'test',
      formats: [{ format_id: 678, ext: 'mp4', vcodec: 'avc1', acodec: 'aac' }]
    })
    expect(info.id).toBe('12345')
    expect(info.formats[0].formatId).toBe('678')
  })
})
