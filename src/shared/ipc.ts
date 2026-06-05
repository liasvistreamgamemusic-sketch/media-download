// IPC チャンネル名とペイロード型（唯一の真実）。
import type {
  DownloadProgress,
  DownloadRequest,
  JobDonePayload,
  MediaInfo,
  Settings
} from './types'

export const IPC = {
  PROBE: 'media:probe', // (url: string) => MediaInfo
  DOWNLOAD_START: 'media:download:start', // (DownloadRequest) => jobId
  DOWNLOAD_CANCEL: 'media:download:cancel', // (jobId: string) => void
  PROGRESS: 'media:progress', // main → renderer: DownloadProgress
  JOB_DONE: 'media:job:done', // main → renderer: JobDonePayload
  PICK_FOLDER: 'dialog:pickFolder', // () => string | null
  OPEN_FOLDER: 'shell:openFolder', // (path: string) => void
  GET_SETTINGS: 'settings:get', // () => Settings
  SET_SETTINGS: 'settings:set', // (Partial<Settings>) => Settings
  ENGINE_VERSION: 'engine:version', // () => string
  ENGINE_UPDATE: 'engine:update', // () => string
  SHOW_DISCLAIMER: 'app:showDisclaimer' // main → renderer: メニューから免責再表示
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]

/** preload が renderer に公開する型付き API（window.api） */
export interface Api {
  probe(url: string): Promise<MediaInfo>
  startDownload(req: DownloadRequest): Promise<string>
  cancelDownload(jobId: string): Promise<void>
  pickFolder(): Promise<string | null>
  openFolder(path: string): Promise<void>
  getSettings(): Promise<Settings>
  setSettings(patch: Partial<Settings>): Promise<Settings>
  engineVersion(): Promise<string>
  updateEngine(): Promise<string>
  /** main → renderer の進捗購読。返り値は解除関数 */
  onProgress(cb: (p: DownloadProgress) => void): () => void
  /** main → renderer のジョブ完了購読。返り値は解除関数 */
  onJobDone(cb: (p: JobDonePayload) => void): () => void
  /** main → renderer の免責再表示購読。返り値は解除関数 */
  onShowDisclaimer(cb: () => void): () => void
}
