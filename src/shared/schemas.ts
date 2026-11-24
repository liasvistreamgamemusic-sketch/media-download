// アプリ境界（IPC ペイロード・保存済み設定）の zod スキーマ。
// URL やダウンロード指定の検証規則は core の DownloadSpecSchema をそのまま使う。
import { z } from 'zod'
import {
  CookieBrowserSchema,
  DownloadSpecSchema,
  OutputFormatSchema
} from '@liasvistreamgamemusic-sketch/media-dl'

export { UrlSchema } from '@liasvistreamgamemusic-sketch/media-dl'

export const DownloadRequestSchema = DownloadSpecSchema.extend({
  addToAppleMusic: z.boolean().optional(),
  itunesAutoAddDir: z.string().nullish()
})

/** v1.4 までの「種別」設定（defaultKind）を出力形式へ読み替える対応表 */
const LEGACY_KIND_TO_FORMAT = {
  video_best: 'mp4',
  audio_mp3: 'mp3',
  audio_lossless: 'audio'
} as const

/** 旧バージョンの保存済み設定を現行の形へ寄せる（キーの改名のみ。値の検証は SettingsSchema が行う）。 */
export function migrateSettings(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw
  const { defaultKind, ...rest } = raw as Record<string, unknown>
  if ('defaultFormat' in rest || typeof defaultKind !== 'string') return rest
  const mapped = LEGACY_KIND_TO_FORMAT[defaultKind as keyof typeof LEGACY_KIND_TO_FORMAT]
  return mapped ? { ...rest, defaultFormat: mapped } : rest
}

// 新規フィールドは .default() を付け、旧バージョンの保存済み設定（キー欠落）でも
// 検証が通り既定値で埋まるようにする（設定の消失を防ぐ）。
export const SettingsSchema = z.object({
  outputDir: z.string(),
  defaultFormat: OutputFormatSchema.default('mp4'),
  embedMetadata: z.boolean(),
  embedThumbnail: z.boolean(),
  disclaimerAccepted: z.boolean(),
  cookiesFromBrowser: CookieBrowserSchema.nullable(),
  addToAppleMusic: z.boolean().default(false),
  itunesAutoAddDir: z.string().nullable().default(null)
})

export const SettingsPatchSchema = SettingsSchema.partial()
