import { describe, it, expect } from 'vitest'
import { buildMetadataFfmpegArgs, hasMetadataOverride } from './applyMetadata'

describe('hasMetadataOverride', () => {
  it('false for undefined / all-empty / whitespace-only', () => {
    expect(hasMetadataOverride()).toBe(false)
    expect(hasMetadataOverride({})).toBe(false)
    expect(hasMetadataOverride({ title: '', artist: '   ' })).toBe(false)
  })

  it('true when any field has content', () => {
    expect(hasMetadataOverride({ album: 'X' })).toBe(true)
    expect(hasMetadataOverride({ comment: '説明' })).toBe(true)
  })
})

describe('buildMetadataFfmpegArgs', () => {
  it('copies all streams without re-encoding and only writes provided tags', () => {
    const args = buildMetadataFfmpegArgs('/in.m4a', '/out.m4a', {
      title: 'My Title',
      album: 'My Album'
    })
    // -map 0 -c copy で埋め込みサムネ等を保持し再エンコードしない
    expect(args.slice(0, 6)).toEqual(['-i', '/in.m4a', '-map', '0', '-c', 'copy'])
    expect(args[args.indexOf('-metadata') + 1]).toBe('title=My Title')
    expect(args).toContain('album=My Album')
    // 未指定フィールドは書かない
    expect(args.some((a) => a.startsWith('artist='))).toBe(false)
    expect(args.some((a) => a.startsWith('comment='))).toBe(false)
    expect(args[args.length - 2]).toBe('-y')
    expect(args[args.length - 1]).toBe('/out.m4a')
  })

  it('passes values verbatim as single argv elements (no escaping needed)', () => {
    const tricky = "Title: with 'quotes', % and\nnewline"
    const args = buildMetadataFfmpegArgs('/in.opus', '/out.opus', { comment: tricky })
    expect(args).toContain(`comment=${tricky}`)
  })

  it('adds -id3v2_version only for mp3 output', () => {
    expect(buildMetadataFfmpegArgs('/in.mp3', '/out.mp3', { title: 't' })).toContain('-id3v2_version')
    expect(buildMetadataFfmpegArgs('/in.m4a', '/out.m4a', { title: 't' })).not.toContain(
      '-id3v2_version'
    )
  })
})
