import { app, shell, BrowserWindow, Menu } from 'electron'
import { join } from 'node:path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { registerIpcHandlers, getQueue } from './ipcHandlers'
import { IPC } from '../shared/ipc'
import { logger } from './logger'

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 760,
    height: 720,
    show: false,
    autoHideMenuBar: false,
    title: 'Media Downloader',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true, // 必須（5章セキュリティ前提）
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true
    }
  })

  win.on('ready-to-show', () => win.show())

  // 外部 URL は既定ブラウザで開く（アプリ内ナビゲーションを防ぐ）
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

function buildMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin'
      ? [{ role: 'appMenu' as const }]
      : []),
    { role: 'fileMenu' },
    { role: 'editMenu' },
    {
      label: 'ヘルプ',
      submenu: [
        {
          label: '免責事項を再表示',
          click: () => {
            for (const w of BrowserWindow.getAllWindows()) {
              w.webContents.send(IPC.SHOW_DISCLAIMER)
            }
          }
        }
      ]
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.example.mediadownloader')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  registerIpcHandlers()
  buildMenu()
  createWindow()
  logger.info('app ready')

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// アプリ終了時に走行中ジョブを確実に終了（孤児プロセス防止）
app.on('before-quit', () => {
  getQueue()?.abortAll()
})
