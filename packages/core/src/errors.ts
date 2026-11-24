import type { MediaErrorCode, MediaErrorInfo } from './types.js'

/** ライブラリが投げる唯一の例外型。message はそのまま利用者に見せてよい文言。 */
export class MediaDownloadError extends Error {
  readonly code: MediaErrorCode
  /** yt-dlp の stderr など調査用の生情報 */
  readonly detail: string

  constructor(info: MediaErrorInfo) {
    super(info.userMessage)
    this.name = 'MediaDownloadError'
    this.code = info.code
    this.detail = info.detail
  }

  toJSON(): MediaErrorInfo {
    return { code: this.code, userMessage: this.message, detail: this.detail }
  }
}

export const CANCELLED_ERROR: MediaErrorInfo = {
  code: 'CANCELLED',
  userMessage: 'ダウンロードを中止しました。',
  detail: ''
}

/** 任意の例外を MediaErrorInfo に正規化する（MediaDownloadError 以外は UNKNOWN）。 */
export function toErrorInfo(e: unknown): MediaErrorInfo {
  if (e instanceof MediaDownloadError) return e.toJSON()
  const detail = e instanceof Error ? e.message : String(e)
  return { code: 'UNKNOWN', userMessage: '不明なエラーが発生しました。詳細をご確認ください。', detail }
}
