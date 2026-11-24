// 境界検証用 zod スキーマ。外部入力（URL・ダウンロード指定・yt-dlp の JSON）を検証する。
import { z } from 'zod'
import { OUTPUT_FORMATS } from './formats.js'

/** http/https のみ許可（file:// 等のローカル参照やスキーム悪用を防ぐ） */
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

export const OutputFormatSchema = z.enum(OUTPUT_FORMATS)

export const CookieBrowserSchema = z.enum([
  'brave',
  'chrome',
  'chromium',
  'edge',
  'firefox',
  'opera',
  'safari',
  'vivaldi',
  'whale'
])

/**
 * 出力ファイル名テンプレート。outputDir の外へ書き出せないよう、
 * 絶対パス・ドライブ指定・".." セグメントを拒否する。
 */
export const FilenameTemplateSchema = z
  .string()
  .min(1)
  .max(512)
  .refine((s) => !/^([/\\]|[A-Za-z]:)/.test(s), { message: 'ファイル名テンプレートに絶対パスは使えません' })
  .refine((s) => !s.split(/[/\\]/).includes('..'), { message: 'ファイル名テンプレートに ".." は使えません' })

export const MetadataOverrideSchema = z.object({
  title: z.string().optional(),
  artist: z.string().optional(),
  album: z.string().optional(),
  comment: z.string().optional()
})

export const DownloadSpecSchema = z.object({
  url: UrlSchema,
  outputDir: z.string().min(1),
  format: OutputFormatSchema.optional(),
  formatSelector: z.string().min(1).max(1024).optional(),
  filenameTemplate: FilenameTemplateSchema.optional(),
  playlist: z.boolean().optional(),
  embedMetadata: z.boolean().optional(),
  embedThumbnail: z.boolean().optional(),
  subtitles: z.boolean().optional(),
  cookiesFromBrowser: CookieBrowserSchema.optional(),
  cookiesFile: z.string().min(1).optional(),
  metadata: MetadataOverrideSchema.optional()
})

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
    format_note: z.string().nullish(),
    video_ext: z.string().nullish(),
    audio_ext: z.string().nullish()
  })
  .loose()

export const RawInfoSchema = z
  .object({
    id: z.union([z.string(), z.number()]).transform(String),
    title: z.string(),
    uploader: z.string().nullish(),
    artist: z.string().nullish(),
    creator: z.string().nullish(),
    album: z.string().nullish(),
    track: z.string().nullish(),
    description: z.string().nullish(),
    duration: z.number().nullish(),
    thumbnail: z.string().nullish(),
    webpage_url: z.string().nullish(),
    original_url: z.string().nullish(),
    extractor: z.string().nullish(),
    extractor_key: z.string().nullish(),
    _type: z.string().nullish(),
    entries: z.array(z.unknown()).nullish(),
    formats: z.array(RawFormatSchema).nullish()
  })
  .loose()

export type RawInfo = z.infer<typeof RawInfoSchema>
export type RawFormat = z.infer<typeof RawFormatSchema>
