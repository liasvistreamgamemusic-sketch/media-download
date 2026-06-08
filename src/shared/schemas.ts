// 境界検証用 zod スキーマ。URL 入力・IPC ペイロード・設定・yt-dlp JSON を検証する。
import { z } from 'zod'

/** http/https のみ許可（13章: スキーム制限） */
export const UrlSchema = z
  .string()
  .trim()
  .min(1, 'URL を入力してください')
  .refine(
    (s) => {
      try {
        const u = new URL(s)
        return u.protocol === 'http:' || u.protocol === 'https:'
      } catch {
        return false
      }
    },
    { message: 'http/https の URL を入力してください' }
  )

export const DownloadKindSchema = z.enum(['video_best', 'audio_mp3', 'audio_lossless'])

export const BrowserForCookiesSchema = z.enum(['chrome', 'edge', 'firefox'])

export const DownloadRequestSchema = z.object({
  url: UrlSchema,
  kind: DownloadKindSchema,
  formatId: z.string().optional(),
  outputDir: z.string().min(1),
  embedMetadata: z.boolean().optional(),
  embedThumbnail: z.boolean().optional(),
  writeSubs: z.boolean().optional(),
  noPlaylist: z.boolean().optional(),
  cookiesFromBrowser: BrowserForCookiesSchema.nullish(),
  addToAppleMusic: z.boolean().optional(),
  itunesAutoAddDir: z.string().nullish()
})

// 新規フィールドは .default() を付け、旧バージョンの保存済み設定（キー欠落）でも
// 検証が通り既定値で埋まるようにする（設定の消失を防ぐ）。
export const SettingsSchema = z.object({
  outputDir: z.string(),
  defaultKind: DownloadKindSchema,
  embedMetadata: z.boolean(),
  embedThumbnail: z.boolean(),
  disclaimerAccepted: z.boolean(),
  cookiesFromBrowser: BrowserForCookiesSchema.nullable(),
  addToAppleMusic: z.boolean().default(false),
  itunesAutoAddDir: z.string().nullable().default(null)
})

export const SettingsPatchSchema = SettingsSchema.partial()

// ---- yt-dlp --dump-single-json の生スキーマ（parseMediaInfo で使用） ----
export const RawFormatSchema = z
  .object({
    format_id: z.union([z.string(), z.number()]).transform(String),
    ext: z.string(),
    vcodec: z.string().nullish(),
    acodec: z.string().nullish(),
    width: z.number().nullish(),
    height: z.number().nullish(),
    fps: z.number().nullish(),
    abr: z.number().nullish(),
    tbr: z.number().nullish(),
    filesize: z.number().nullish(),
    filesize_approx: z.number().nullish(),
    format_note: z.string().nullish()
  })
  .loose()

export const RawInfoSchema = z
  .object({
    id: z.union([z.string(), z.number()]).transform(String),
    title: z.string(),
    uploader: z.string().nullish(),
    duration: z.number().nullish(),
    thumbnail: z.string().nullish(),
    webpage_url: z.string().nullish(),
    original_url: z.string().nullish(),
    extractor: z.string().nullish(),
    extractor_key: z.string().nullish(),
    _type: z.string().nullish(),
    entries: z.array(z.any()).nullish(),
    formats: z.array(RawFormatSchema).nullish()
  })
  .loose()

export type RawInfo = z.infer<typeof RawInfoSchema>
export type RawFormat = z.infer<typeof RawFormatSchema>
