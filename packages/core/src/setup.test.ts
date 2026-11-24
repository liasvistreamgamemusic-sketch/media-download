import { describe, it, expect } from 'vitest'
import { assetFor } from './setup.js'

describe('assetFor', () => {
  it('maps yt-dlp release assets per platform', () => {
    expect(assetFor('yt-dlp', 'win32', 'x64')?.url).toMatch(/\/yt-dlp\.exe$/)
    expect(assetFor('yt-dlp', 'darwin', 'arm64')?.url).toMatch(/\/yt-dlp_macos$/)
    expect(assetFor('yt-dlp', 'linux', 'x64')?.url).toMatch(/\/yt-dlp_linux$/)
    expect(assetFor('yt-dlp', 'linux', 'arm64')?.url).toMatch(/\/yt-dlp_linux_aarch64$/)
    expect(assetFor('yt-dlp', 'win32', 'arm64')).toBeNull()
  })

  it('maps ffmpeg-static gz assets only for published targets', () => {
    expect(assetFor('ffmpeg', 'linux', 'x64')?.url).toMatch(/\/ffmpeg-linux-x64\.gz$/)
    expect(assetFor('ffprobe', 'darwin', 'arm64')?.url).toMatch(/\/ffprobe-darwin-arm64\.gz$/)
    expect(assetFor('ffmpeg', 'win32', 'x64')?.url).toMatch(/\/ffmpeg-win32-x64\.gz$/)
    expect(assetFor('ffmpeg', 'win32', 'arm64')).toBeNull()
    expect(assetFor('ffmpeg', 'freebsd', 'x64')).toBeNull()
  })

  it('maps deno zip by target triple', () => {
    expect(assetFor('deno', 'linux', 'arm64')?.url).toMatch(/\/deno-aarch64-unknown-linux-gnu\.zip$/)
    expect(assetFor('deno', 'darwin', 'x64')?.url).toMatch(/\/deno-x86_64-apple-darwin\.zip$/)
    expect(assetFor('deno', 'win32', 'x64')?.url).toMatch(/\/deno-x86_64-pc-windows-msvc\.zip$/)
    expect(assetFor('deno', 'linux', 'ia32')).toBeNull()
  })
})
