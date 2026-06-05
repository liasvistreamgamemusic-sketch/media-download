import { RawInfoSchema } from '../shared/schemas'
import type { FormatOption, MediaInfo } from '../shared/types'

const has = (v?: string | null): boolean => !!v && v !== 'none'

/**
 * yt-dlp --dump-single-json の出力を zod 検証して MediaInfo に写像する純粋関数。
 * 映像/音声の有無（capability）はここで導出する。
 */
export function parseMediaInfo(json: unknown): MediaInfo {
  const raw = RawInfoSchema.parse(json)
  const isPlaylist = raw._type === 'playlist' || Array.isArray(raw.entries)

  const formats: FormatOption[] = (raw.formats ?? []).map((f) => ({
    formatId: f.format_id,
    ext: f.ext,
    resolution: f.width && f.height ? `${f.width}x${f.height}` : null,
    fps: f.fps ?? null,
    vcodec: has(f.vcodec) ? f.vcodec! : null,
    acodec: has(f.acodec) ? f.acodec! : null,
    abr: f.abr ?? null,
    tbr: f.tbr ?? null,
    filesize: f.filesize ?? f.filesize_approx ?? null,
    isVideo: has(f.vcodec),
    isAudio: has(f.acodec),
    note: f.format_note ?? null
  }))

  return {
    id: raw.id,
    title: raw.title,
    uploader: raw.uploader ?? null,
    durationSec: raw.duration ?? null,
    thumbnailUrl: raw.thumbnail ?? null,
    webpageUrl: raw.webpage_url ?? raw.original_url ?? '',
    extractor: raw.extractor ?? raw.extractor_key ?? 'generic',
    isPlaylist,
    playlistCount: raw.entries?.length ?? null,
    hasVideo: formats.some((f) => f.isVideo), // SoundCloud は false
    hasAudio: formats.some((f) => f.isAudio),
    formats
  }
}
