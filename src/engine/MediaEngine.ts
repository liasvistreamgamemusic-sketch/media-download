import type { DownloadProgress, DownloadRequest, DownloadResult, MediaInfo } from '../shared/types'

export interface ProbeOptions {
  flat?: boolean
}

export interface DownloadHooks {
  onProgress: (p: DownloadProgress) => void
  signal: AbortSignal
}

/**
 * メディアエンジンの抽象。yt-dlp の呼び出しはこの IF の内側だけに閉じ込める。
 * UI / アプリ層は実装ではなくこの IF に依存する（モック可能）。
 */
export interface MediaEngine {
  /** URL を解析して構造化情報を返す（--dump-single-json） */
  probe(url: string, opts?: ProbeOptions): Promise<MediaInfo>

  /** 実ダウンロード。進捗は onProgress、中断は signal で */
  download(req: DownloadRequest, hooks: DownloadHooks): Promise<DownloadResult>

  /** yt-dlp のバージョン文字列 */
  engineVersion(): Promise<string>

  /** yt-dlp 自己更新（plan.md 16.3） */
  updateEngine(): Promise<string>
}
