import { RawInfoSchema } from './schemas.js'
import type { RawFormat } from './schemas.js'
import type { FormatOption, MediaInfo } from './types.js'

const has = (v?: string | null): boolean => !!v && v !== 'none'

/**
 * 映像/音声の有無を判定する。yt-dlp は「無い」を 'none'、「不明」を null/欠落で表す。
 * YouTube 等は codec を明示するが、直リンクや <video> 埋め込み（generic / html5 抽出器）は
 * codec が不明で video_ext だけが入る。不明を「無い」と扱うと動画を音声のみと誤判定するため区別する。
 */
function capabilities(f: RawFormat): { isVideo: boolean; isAudio: boolean } {
  const isVideo = f.vcodec != null ? f.vcodec !== 'none' : has(f.video_ext)
  // 音声コーデックが不明な単一ファイルは、映像付きでも音声を含むのが普通なので「あり」とみなす
  const isAudio = f.acodec != null ? f.acodec !== 'none' : isVideo || has(f.audio_ext)
  return { isVideo, isAudio }
}

/**
 * yt-dlp --dump-single-json の出力を zod 検証して MediaInfo に写像する純粋関数。
 * 映像/音声の有無（capability）はここで導出する。
 */
export function parseMediaInfo(json: unknown): MediaInfo {
  const raw = RawInfoSchema.parse(json)
  const isPlaylist = raw._type === 'playlist' || Array.isArray(raw.entries)

  const formats: FormatOption[] = (raw.formats ?? []).map((f) => ({
    ...capabilities(f),
    formatId: f.format_id,
    ext: f.ext,
    resolution: f.width && f.height ? `${f.width}x${f.height}` : null,
    fps: f.fps ?? null,
    vcodec: has(f.vcodec) ? f.vcodec! : null,
    acodec: has(f.acodec) ? f.acodec! : null,
    abr: f.abr ?? null,
    tbr: f.tbr ?? null,
    filesize: f.filesize ?? f.filesize_approx ?? null,
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
    formats,
    // メタデータ編集欄のプリフィル（取得できたものだけ。無ければ null → UI 側で uploader 等にフォールバック）
    artist: raw.artist ?? raw.creator ?? null,
    album: raw.album ?? null,
    description: raw.description ?? null
  }
}
