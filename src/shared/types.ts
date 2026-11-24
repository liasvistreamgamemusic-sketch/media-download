// アプリ固有のドメイン型。メディア取得に関わる型は core パッケージが唯一の真実で、ここでは再エクスポートする。
// このファイルは electron に依存しない（純粋な型定義のみ）。
import type {
  CookieBrowser,
  DownloadProgress as CoreProgress,
  DownloadSpec,
  MediaErrorInfo,
  OutputFormat
} from '@liasvistreamgamemusic-sketch/media-dl'

export type {
  CookieBrowser,
  FormatOption,
  MediaInfo,
  MetadataOverride,
  OutputFormat
} from '@liasvistreamgamemusic-sketch/media-dl'

export type JobStatus =
  | 'queued'
  | 'analyzing'
  | 'downloading'
  | 'postprocessing'
  | 'completed'
  | 'failed'
  | 'cancelled'

export interface DownloadProgress extends Omit<CoreProgress, 'status'> {
  jobId: string
  status: JobStatus
}

/** renderer → main のダウンロード依頼。core の DownloadSpec に Apple Music 連携を足したもの。 */
export interface DownloadRequest extends DownloadSpec {
  // 完了後に Apple Music（クラシック iTunes の自動追加フォルダ）へ追加するか
  addToAppleMusic?: boolean
  // 自動追加フォルダの明示指定。null/undefined なら既定の場所を自動検出する
  itunesAutoAddDir?: string | null
}

/** Apple Music（iTunes 自動追加フォルダ）への追加結果。 */
export interface AppleMusicOutcome {
  attempted: boolean
  added: boolean
  message: string // ユーザー向け（日本語）
}

export interface DownloadResult {
  jobId: string
  files: string[]
  appleMusic?: AppleMusicOutcome
}

export type AppError = MediaErrorInfo

export interface Settings {
  outputDir: string
  defaultFormat: OutputFormat
  embedMetadata: boolean
  embedThumbnail: boolean
  disclaimerAccepted: boolean
  cookiesFromBrowser: CookieBrowser | null
  // 完了後に Apple Music へ自動追加する（クラシック iTunes 経由・iCloudでiPhoneへ同期）
  addToAppleMusic: boolean
  // iTunes 自動追加フォルダの明示指定（null なら自動検出）
  itunesAutoAddDir: string | null
}

/** ジョブ完了イベント（成功 or 失敗の判別ユニオン） */
export type JobDonePayload =
  | { jobId: string; ok: true; result: DownloadResult }
  | { jobId: string; ok: false; error: AppError }
