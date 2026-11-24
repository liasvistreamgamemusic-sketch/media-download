// 公開ドメイン型（唯一の真実）。純粋な型定義のみで、node / electron に依存しない。
import type { OutputFormat } from './formats.js'

export type { OutputFormat }

/** yt-dlp --cookies-from-browser が受け付けるブラウザ（yt-dlp 2026.11.23 の --help で確認）。 */
export type CookieBrowser =
  | 'brave'
  | 'chrome'
  | 'chromium'
  | 'edge'
  | 'firefox'
  | 'opera'
  | 'safari'
  | 'vivaldi'
  | 'whale'

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
  hasVideo: boolean
  hasAudio: boolean
  formats: FormatOption[]
  artist: string | null
  album: string | null
  description: string | null
}

/** 埋め込みタグの上書き値（空文字・空白のみは「指定なし」扱い）。 */
export interface MetadataOverride {
  title?: string
  artist?: string
  album?: string
  comment?: string
}

/** 進捗の段階。finished 後の結合・変換は postprocessing として通知する。 */
export type ProgressStatus = 'downloading' | 'postprocessing' | 'failed'

export interface DownloadProgress {
  status: ProgressStatus
  percent: number | null
  downloadedBytes: number | null
  totalBytes: number | null
  speedBps: number | null
  etaSec: number | null
}

/** シリアライズ可能なダウンロード指定（IPC・CLI・設定でそのまま受け渡せる部分）。 */
export interface DownloadSpec {
  url: string
  /** 保存先ディレクトリ。無ければ作成する。相対パスはカレントディレクトリ基準。 */
  outputDir: string
  /** 出力形式。既定は mp4。 */
  format?: OutputFormat
  /** yt-dlp の -f に渡すフォーマット選択式（例: "137+140", "bv*[height<=1080]+ba/b"）。 */
  formatSelector?: string
  /** 出力ファイル名テンプレート（yt-dlp の -o 構文）。outputDir からの相対のみ許可。 */
  filenameTemplate?: string
  /** プレイリスト URL のとき全件を取得する。既定 false（単体のみ）。 */
  playlist?: boolean
  /** 既定 true */
  embedMetadata?: boolean
  /** 既定 true。形式が非対応（webm / wav / best）のときは自動で無効になる。 */
  embedThumbnail?: boolean
  /** 字幕（全言語）を別ファイルで保存する。既定 false */
  subtitles?: boolean
  cookiesFromBrowser?: CookieBrowser
  /** Netscape 形式の cookie ファイル */
  cookiesFile?: string
  /** 取得後に ffmpeg で埋め込みタグを上書きする */
  metadata?: MetadataOverride
}

export interface DownloadOptions extends DownloadSpec {
  onProgress?: (p: DownloadProgress) => void
  signal?: AbortSignal
}

export interface DownloadResult {
  /** 保存されたファイルの絶対パス（プレイリスト時は複数） */
  files: string[]
  /** 処理は成功したが一部が適用できなかったもの（タグ上書き失敗など） */
  warnings: string[]
}

export interface ProbeOptions {
  /** プレイリストを展開せず一覧だけ取る */
  flat?: boolean
  cookiesFromBrowser?: CookieBrowser
  cookiesFile?: string
}

/** 実行バイナリの解決結果。ffmpegDir は yt-dlp --ffmpeg-location にディレクトリで渡す。 */
export interface BinPaths {
  ytDlp: string
  ffmpegDir: string | null
  /** 明示指定・キャッシュにある deno。PATH 上の deno は yt-dlp 自身が見つけるため含めない。 */
  deno?: string
}

/** バイナリの明示指定。未指定の項目は環境変数 → キャッシュ → PATH の順で探す。 */
export interface BinaryOptions {
  ytDlp?: string
  ffmpegDir?: string
  deno?: string
  /** `media-dl setup` の導入先（既定: ユーザーキャッシュ配下） */
  binDir?: string
}

export type MediaErrorCode =
  | 'INVALID_INPUT'
  | 'ENGINE_MISSING'
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

/** IPC や JSON 出力で受け渡すエラーの平坦な形 */
export interface MediaErrorInfo {
  code: MediaErrorCode
  userMessage: string
  detail: string
}
