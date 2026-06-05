import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { accessSync, constants, statSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import { z } from 'zod'
import { IPC } from '../shared/ipc'
import { DownloadRequestSchema, SettingsPatchSchema, UrlSchema } from '../shared/schemas'
import { YtDlpEngine } from '../engine/YtDlpEngine'
import { JobQueue } from './JobQueue'
import { getBinPaths } from './paths'
import { getSettings, setSettings } from './settings'
import { logger } from './logger'
import type { MediaInfo } from '../shared/types'

let queue: JobQueue | null = null

/** 保存先の検証：絶対パスかつ実在ディレクトリかつ書き込み可能であること。 */
function assertWritableDir(dir: string): void {
  if (!isAbsolute(dir)) throw new Error(`保存先は絶対パスである必要があります: ${dir}`)
  let st: ReturnType<typeof statSync>
  try {
    st = statSync(dir)
  } catch {
    throw new Error(`保存先が存在しません: ${dir}`)
  }
  if (!st.isDirectory()) throw new Error(`保存先がディレクトリではありません: ${dir}`)
  try {
    accessSync(dir, constants.W_OK)
  } catch {
    throw new Error(`保存先に書き込めません: ${dir}`)
  }
}

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, payload)
  }
}

export function registerIpcHandlers(): JobQueue {
  const engine = new YtDlpEngine(getBinPaths())
  queue = new JobQueue(engine, {
    onProgress: (p) => broadcast(IPC.PROGRESS, p),
    onDone: (p) => broadcast(IPC.JOB_DONE, p)
  })

  // probe: URL を zod 検証してから（信頼境界の内側で再検証）
  ipcMain.handle(IPC.PROBE, async (_e, url: unknown): Promise<MediaInfo> => {
    const safe = UrlSchema.parse(url)
    return engine.probe(safe)
  })

  ipcMain.handle(IPC.DOWNLOAD_START, async (_e, req: unknown): Promise<string> => {
    const safe = DownloadRequestSchema.parse(req)
    assertWritableDir(safe.outputDir) // 13章: 保存先は実在・書き込み可能な絶対パスのみ
    return queue!.enqueue(safe)
  })

  ipcMain.handle(IPC.DOWNLOAD_CANCEL, async (_e, jobId: unknown): Promise<void> => {
    queue!.cancel(z.string().parse(jobId))
  })

  ipcMain.handle(IPC.PICK_FOLDER, async (): Promise<string | null> => {
    const win = BrowserWindow.getFocusedWindow()
    const opts: Electron.OpenDialogOptions = {
      properties: ['openDirectory', 'createDirectory']
    }
    const r = win
      ? await dialog.showOpenDialog(win, opts)
      : await dialog.showOpenDialog(opts)
    return r.canceled || r.filePaths.length === 0 ? null : r.filePaths[0]
  })

  ipcMain.handle(IPC.OPEN_FOLDER, async (_e, p: unknown): Promise<void> => {
    const path = z.string().min(1).parse(p)
    await shell.openPath(path)
  })

  ipcMain.handle(IPC.GET_SETTINGS, async () => getSettings())

  ipcMain.handle(IPC.SET_SETTINGS, async (_e, patch: unknown) => {
    const safe = SettingsPatchSchema.parse(patch)
    return setSettings(safe)
  })

  ipcMain.handle(IPC.ENGINE_VERSION, async (): Promise<string> => {
    try {
      return await engine.engineVersion()
    } catch (e) {
      logger.error('engineVersion failed', { error: String(e) })
      return 'unknown'
    }
  })

  ipcMain.handle(IPC.ENGINE_UPDATE, async (): Promise<string> => engine.updateEngine())

  return queue
}

export function getQueue(): JobQueue | null {
  return queue
}
