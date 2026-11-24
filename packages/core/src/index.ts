// 公開 API。
//   import { download } from '@liasvistreamgamemusic-sketch/media-dl'
//   const { files } = await download({ url, format: 'mp3', outputDir: './out' })
import { MediaDownloader } from './MediaDownloader.js'
import type { BinaryOptions, DownloadOptions, DownloadResult, MediaInfo, ProbeOptions } from './types.js'

export { MediaDownloader } from './MediaDownloader.js'
export { CANCELLED_ERROR, MediaDownloadError, toErrorInfo } from './errors.js'
export { DEFAULT_FORMAT, FORMAT_SPECS, OUTPUT_FORMATS, isOutputFormat, isVideoFormat } from './formats.js'
export type { FormatSpec } from './formats.js'
export { ENV, defaultBinDir, exeName, resolveBinaries } from './binaries.js'
export { setupBinaries } from './setup.js'
export type { BinaryName, SetupOptions, SetupResult } from './setup.js'
export { DownloadSpecSchema, OutputFormatSchema, CookieBrowserSchema, UrlSchema } from './schemas.js'
export type * from './types.js'

/** 1 回限りのダウンロード。複数回呼ぶなら MediaDownloader を使い回す方がバイナリ解決が 1 回で済む。 */
export function download(opts: DownloadOptions & { binaries?: BinaryOptions }): Promise<DownloadResult> {
  const { binaries, ...rest } = opts
  return new MediaDownloader(binaries).download(rest)
}

/** 1 回限りの解析 */
export function probe(url: string, opts: ProbeOptions & { binaries?: BinaryOptions } = {}): Promise<MediaInfo> {
  const { binaries, ...rest } = opts
  return new MediaDownloader(binaries).probe(url, rest)
}
