import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc'
import type { Api } from '../shared/ipc'
import type { DownloadProgress, DownloadRequest, JobDonePayload, Settings } from '../shared/types'

// renderer に公開する最小 API。ipcRenderer の生サーフェスは公開しない（13章: 最小 API のみ）。
const api: Api = {
  probe: (url) => ipcRenderer.invoke(IPC.PROBE, url),
  startDownload: (req: DownloadRequest) => ipcRenderer.invoke(IPC.DOWNLOAD_START, req),
  cancelDownload: (jobId) => ipcRenderer.invoke(IPC.DOWNLOAD_CANCEL, jobId),
  pickFolder: () => ipcRenderer.invoke(IPC.PICK_FOLDER),
  openFolder: (path) => ipcRenderer.invoke(IPC.OPEN_FOLDER, path),
  resolveItunesDir: (configured) => ipcRenderer.invoke(IPC.RESOLVE_ITUNES_DIR, configured),
  getSettings: () => ipcRenderer.invoke(IPC.GET_SETTINGS),
  setSettings: (patch: Partial<Settings>) => ipcRenderer.invoke(IPC.SET_SETTINGS, patch),
  engineVersion: () => ipcRenderer.invoke(IPC.ENGINE_VERSION),
  updateEngine: () => ipcRenderer.invoke(IPC.ENGINE_UPDATE),
  onProgress: (cb: (p: DownloadProgress) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, p: DownloadProgress): void => cb(p)
    ipcRenderer.on(IPC.PROGRESS, listener)
    return () => ipcRenderer.removeListener(IPC.PROGRESS, listener)
  },
  onJobDone: (cb: (p: JobDonePayload) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, p: JobDonePayload): void => cb(p)
    ipcRenderer.on(IPC.JOB_DONE, listener)
    return () => ipcRenderer.removeListener(IPC.JOB_DONE, listener)
  },
  onShowDisclaimer: (cb: () => void) => {
    const listener = (): void => cb()
    ipcRenderer.on(IPC.SHOW_DISCLAIMER, listener)
    return () => ipcRenderer.removeListener(IPC.SHOW_DISCLAIMER, listener)
  }
}

// contextIsolation は main で常に有効（index.ts の webPreferences）。無効化された場合に
// window へ直接生やすフォールバックは持たない（renderer に Node 側の参照を渡さないため）。
contextBridge.exposeInMainWorld('api', api)
