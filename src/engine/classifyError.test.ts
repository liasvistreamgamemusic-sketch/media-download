import { describe, it, expect } from 'vitest'
import { classifyError } from './classifyError'

const cases: Array<[string, string]> = [
  ['ERROR: Unsupported URL: https://example.com/foo', 'UNSUPPORTED_URL'],
  ['ERROR: [youtube] abc: Video unavailable', 'UNAVAILABLE'],
  ['ERROR: This video is private', 'UNAVAILABLE'],
  ['ERROR: The uploader has not made this video available in your country', 'GEO_BLOCKED'],
  ['ERROR: Sign in to confirm your age. This video may be inappropriate', 'AGE_RESTRICTED'],
  ['ERROR: This video requires authentication / login required', 'AUTH_REQUIRED'],
  ['ERROR: HTTP Error 403: Forbidden', 'AUTH_REQUIRED'],
  ['ERROR: ffmpeg not found. Please install', 'FFMPEG_MISSING'],
  ['ERROR: Unable to download webpage: <urlopen error timed out>', 'NETWORK'],
  ['ERROR: [Errno -3] Temporary failure in name resolution', 'NETWORK'],
  ['ERROR: No space left on device', 'DISK'],
  ['ERROR: Please update yt-dlp to the latest version', 'ENGINE_OUTDATED'],
  ['ERROR: nsig extraction failed: Some formats may be missing', 'ENGINE_OUTDATED']
]

describe('classifyError', () => {
  it.each(cases)('classifies %s', (stderr, expected) => {
    const e = classifyError(stderr)
    expect(e.code).toBe(expected)
    expect(e.userMessage.length).toBeGreaterThan(0)
    expect(e.detail).toBe(stderr) // 生ログは常に保持
  })

  it('falls back to UNKNOWN while preserving raw log', () => {
    const raw = 'ERROR: something totally novel happened xyz123'
    const e = classifyError(raw)
    expect(e.code).toBe('UNKNOWN')
    expect(e.detail).toBe(raw)
  })

  it('first matching rule wins (UNSUPPORTED before UNKNOWN)', () => {
    expect(classifyError('Unsupported URL').code).toBe('UNSUPPORTED_URL')
  })
})
