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

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (sandbox 無効時のフォールバック)
  window.api = api
}
