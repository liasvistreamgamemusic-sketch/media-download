// ドメイン型・エラー型（唯一の真実）。main / preload / renderer / engine で共有する。
// このファイルは electron に依存しない（純粋な型定義のみ）。

export type DownloadKind = 'video_best' | 'audio_mp3' | 'audio_lossless'

export interface FormatOption {
  formatId: string
  ext: string
  resolution: string | null
  fps: number | null
  vcodec: string | null
  acodec: string | null
  abr: number | null
  tbr: number | null
  filesize: number | null
  isVideo: boolean
  isAudio: boolean
  note: string | null
}

export interface MediaInfo {
  id: string
  title: string
  uploader: string | null
  durationSec: number | null
  thumbnailUrl: string | null
  webpageUrl: string
  extractor: string
  isPlaylist: boolean
  playlistCount: number | null
  hasVideo: boolean // capability フラグ（UI 適応に使う）
  hasAudio: boolean
  formats: FormatOption[]
}

export type JobStatus =
  | 'queued'
  | 'analyzing'
  | 'downloading'
  | 'postprocessing'
  | 'completed'
  | 'failed'
  | 'cancelled'

export interface DownloadProgress {
  jobId: string
  status: JobStatus
  percent: number | null
  downloadedBytes: number | null
  totalBytes: number | null
  speedBps: number | null
  etaSec: number | null
}

export type BrowserForCookies = 'chrome' | 'edge' | 'firefox'

export interface DownloadRequest {
  url: string
  kind: DownloadKind
  formatId?: string // 明示選択時のみ。おまかせなら undefined
  outputDir: string
  embedMetadata?: boolean
  embedThumbnail?: boolean
  writeSubs?: boolean
  noPlaylist?: boolean
  cookiesFromBrowser?: BrowserForCookies | null
}

export interface DownloadResult {
  jobId: string
  outputPath: string | null
}

export type AppErrorCode =
  | 'UNSUPPORTED_URL'
  | 'UNAVAILABLE'
  | 'GEO_BLOCKED'
  | 'AGE_RESTRICTED'
  | 'NETWORK'
  | 'AUTH_REQUIRED'
  | 'FFMPEG_MISSING'
  | 'ENGINE_OUTDATED'
  | 'DISK'
  | 'CANCELLED'
  | 'UNKNOWN'

export interface AppError {
  code: AppErrorCode
  userMessage: string
  detail: string
}

export interface Settings {
  outputDir: string
  defaultKind: DownloadKind
  embedMetadata: boolean
  embedThumbnail: boolean
  disclaimerAccepted: boolean
  cookiesFromBrowser: BrowserForCookies | null
}

/** バイナリのパス解決結果（buildArgs に渡す） */
export interface BinPaths {
  ytDlp: string
  ffmpegDir: string
}

/** ジョブ完了イベント（成功 or 失敗の判別ユニオン） */
export type JobDonePayload =
  | { jobId: string; ok: true; result: DownloadResult }
  | { jobId: string; ok: false; error: AppError }
