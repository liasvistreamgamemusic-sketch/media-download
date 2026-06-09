import { app, dialog, shell, BrowserWindow } from 'electron'
import electronUpdater, { type AppUpdater } from 'electron-updater'
import { logger } from './logger'

const OWNER = 'liasvistreamgamemusic-sketch'
const REPO = 'media-download'
const RELEASES_URL = `https://github.com/${OWNER}/${REPO}/releases/latest`
const LATEST_API = `https://api.github.com/repos/${OWNER}/${REPO}/releases/latest`

/**
 * electron-updater は CommonJS。electron-vite 環境では named import が undefined に
 * なることがあるため default 経由で取り出す（electron-vite 公式の回避策）。
 */
function getAutoUpdater(): AppUpdater {
  const { autoUpdater } = electronUpdater
  return autoUpdater
}

/** a が b より新しいバージョンか（"1.2.10" > "1.2.2" を正しく判定する素朴な semver 比較）。 */
function isNewer(a: string, b: string): boolean {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0)
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d > 0
  }
  return false
}

let winEventsWired = false

/** update-downloaded（DL完了→再起動適用）のダイアログを一度だけ購読する。 */
function wireWindowsEvents(win: BrowserWindow): void {
  if (winEventsWired) return
  winEventsWired = true
  const autoUpdater = getAutoUpdater()
  autoUpdater.on('error', (err) => logger.error('autoUpdater error', { err: String(err) }))
  autoUpdater.on('update-downloaded', (info) => {
    void dialog
      .showMessageBox(win, {
        type: 'info',
        buttons: ['再起動して更新', '後で'],
        defaultId: 0,
        cancelId: 1,
        title: 'アップデート',
        message: `新しいバージョン ${info.version} をダウンロードしました。`,
        detail: '再起動すると更新が適用されます。'
      })
      .then((r) => {
        if (r.response === 0) autoUpdater.quitAndInstall()
      })
  })
}

/**
 * Windows: electron-updater で更新を確認し、自動DL→再起動で適用（NSIS は無署名でも更新可）。
 * manual=true（メニューから）は「最新です」「更新あり」「確認失敗」を必ずダイアログで返す。
 * getAutoUpdater() の interop 失敗など同期エラーも握りつぶさず、手動時はダイアログ化する
 *（無反応＝原因不明、を避ける）。
 */
async function checkWindows(win: BrowserWindow, manual: boolean): Promise<void> {
  try {
    const autoUpdater = getAutoUpdater()
    autoUpdater.autoDownload = true
    wireWindowsEvents(win)
    const result = await autoUpdater.checkForUpdates()
    const latest = result?.updateInfo?.version
    const available = !!latest && isNewer(latest, app.getVersion())
    if (available) {
      logger.info('update available', { version: latest })
      if (manual) {
        await dialog.showMessageBox(win, {
          type: 'info',
          buttons: ['OK'],
          title: 'アップデート',
          message: `新しいバージョン ${latest} が見つかりました。`,
          detail: 'バックグラウンドでダウンロードし、完了したら再起動をご案内します。'
        })
      }
    } else {
      logger.info('update not available', { latest })
      if (manual) {
        await dialog.showMessageBox(win, {
          type: 'info',
          buttons: ['OK'],
          title: 'アップデート',
          message: `最新バージョンを使用しています（${app.getVersion()}）。`
        })
      }
    }
  } catch (e) {
    logger.error('checkForUpdates failed', { e: String(e) })
    if (manual) {
      await dialog.showMessageBox(win, {
        type: 'warning',
        buttons: ['OK'],
        title: 'アップデート',
        message: 'アップデートの確認に失敗しました。',
        detail: e instanceof Error ? e.message : String(e)
      })
    }
  }
}

/**
 * macOS: Squirrel.Mac は有効なコード署名が必須のため自動更新は行えない。
 * GitHub API で最新版を確認し、新版があればDLページを開く（通知のみ）。
 * manual=true のときは「最新です」「確認失敗」も通知する。
 */
async function checkMacUpdate(win: BrowserWindow, manual: boolean): Promise<void> {
  try {
    const res = await fetch(LATEST_API, { headers: { Accept: 'application/vnd.github+json' } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = (await res.json()) as { tag_name?: string }
    const latest = (data.tag_name ?? '').replace(/^v/, '')
    const current = app.getVersion()
    if (latest && isNewer(latest, current)) {
      const r = await dialog.showMessageBox(win, {
        type: 'info',
        buttons: ['ダウンロード', '後で'],
        defaultId: 0,
        cancelId: 1,
        title: 'アップデート',
        message: `新しいバージョン ${latest} があります（現在 ${current}）。`,
        detail: 'ダウンロードページを開きます。'
      })
      if (r.response === 0) void shell.openExternal(RELEASES_URL)
    } else if (manual) {
      await dialog.showMessageBox(win, {
        type: 'info',
        buttons: ['OK'],
        title: 'アップデート',
        message: '最新バージョンを使用しています。'
      })
    }
  } catch (e) {
    logger.error('mac update check failed', { e: String(e) })
    if (manual) {
      await dialog.showMessageBox(win, {
        type: 'warning',
        buttons: ['OK'],
        title: 'アップデート',
        message: 'アップデートの確認に失敗しました。'
      })
    }
  }
}

/** 起動時の自動チェック。dev（未パッケージ）ではスキップ。 */
export function initAutoUpdate(win: BrowserWindow): void {
  if (!app.isPackaged) return
  if (process.platform === 'win32') void checkWindows(win, false)
  else if (process.platform === 'darwin') void checkMacUpdate(win, false)
}

/** メニューからの手動チェック。結果は必ずダイアログで通知する。 */
export function checkForUpdatesManually(win: BrowserWindow): void {
  if (process.platform === 'win32') {
    if (!app.isPackaged) {
      void dialog.showMessageBox(win, {
        type: 'info',
        buttons: ['OK'],
        title: 'アップデート',
        message: '開発ビルドでは更新確認をスキップします。'
      })
      return
    }
    void checkWindows(win, true)
  } else if (process.platform === 'darwin') {
    void checkMacUpdate(win, true)
  }
}
