import Store from 'electron-store'
import { app } from 'electron'
import { SettingsSchema } from '../shared/schemas'
import type { Settings } from '../shared/types'
import { logger } from './logger'

function defaults(): Settings {
  return {
    outputDir: app.getPath('downloads'),
    defaultKind: 'video_best',
    embedMetadata: true,
    embedThumbnail: true,
    disclaimerAccepted: false,
    cookiesFromBrowser: null
  }
}

const store = new Store<{ settings: Settings }>({ name: 'config' })

export function getSettings(): Settings {
  const raw = store.get('settings')
  const parsed = SettingsSchema.safeParse(raw)
  if (parsed.success) return parsed.data
  // 破損 / 未設定はデフォルトにフォールバック（14章）
  if (raw !== undefined) logger.warn('settings corrupted, using defaults')
  const d = defaults()
  store.set('settings', d)
  return d
}

export function setSettings(patch: Partial<Settings>): Settings {
  const next = { ...getSettings(), ...patch }
  const parsed = SettingsSchema.safeParse(next)
  if (!parsed.success) {
    logger.warn('invalid settings patch ignored', { issues: parsed.error.issues })
    return getSettings()
  }
  store.set('settings', parsed.data)
  return parsed.data
}
