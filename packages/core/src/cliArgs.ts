// CLI 引数の解釈（純粋関数。I/O しない）。
import { parseArgs } from 'node:util'
import { DEFAULT_FORMAT, isOutputFormat, OUTPUT_FORMATS } from './formats.js'
import { CookieBrowserSchema } from './schemas.js'
import type { CookieBrowser, DownloadSpec, MetadataOverride } from './types.js'

export const USAGE = `使い方:
  media-dl <URL...> [オプション]     URL を取得して保存する
  media-dl info <URL> [--json]       ダウンロードせずに情報を表示する
  media-dl formats                   指定できる出力形式の一覧
  media-dl setup [--force]           yt-dlp / ffmpeg / deno を導入する（初回のみ）
  media-dl update                    yt-dlp を最新版に更新する

オプション:
  -f, --format <形式>         出力形式（既定 ${DEFAULT_FORMAT}）: ${OUTPUT_FORMATS.join(', ')}
  -o, --output <ディレクトリ>  保存先（既定: カレントディレクトリ。無ければ作成）
  -n, --name <テンプレート>    ファイル名（yt-dlp の -o 構文。例 "%(title)s.%(ext)s"）
  -s, --select <選択式>        yt-dlp のフォーマット選択式（例 "bv*[height<=720]+ba/b"）
      --playlist              プレイリストを全件取得する（既定は単体のみ）
      --no-metadata           メタデータを埋め込まない
      --no-thumbnail          サムネイルを埋め込まない
      --subs                  字幕を保存する
      --cookies-from-browser <ブラウザ>  ブラウザの cookie を使う（${CookieBrowserSchema.options.join(', ')}）
      --cookies <ファイル>     Netscape 形式の cookie ファイルを使う
      --title / --artist / --album / --comment <値>  埋め込みタグを上書きする
      --bin-dir <ディレクトリ>  バイナリの場所（setup の導入先も兼ねる）
      --json                  進捗と結果を 1 行 1 JSON で標準出力に出す
  -q, --quiet                 進捗を表示しない
  -h, --help / -v, --version

標準出力には保存したファイルの絶対パスを 1 行ずつ出します（--json 時を除く）。`

export type CliCommand =
  | { kind: 'help' }
  | { kind: 'version' }
  | { kind: 'formats' }
  | { kind: 'setup'; force: boolean; binDir?: string }
  | { kind: 'update'; binDir?: string }
  | { kind: 'info'; url: string; json: boolean; binDir?: string; cookiesFromBrowser?: CookieBrowser; cookiesFile?: string }
  | {
      kind: 'download'
      urls: string[]
      spec: Omit<DownloadSpec, 'url'>
      json: boolean
      quiet: boolean
      binDir?: string
    }

export class UsageError extends Error {}

const SUBCOMMANDS = new Set(['info', 'formats', 'setup', 'update', 'download'])

const OPTIONS = {
  format: { type: 'string', short: 'f' },
  output: { type: 'string', short: 'o' },
  name: { type: 'string', short: 'n' },
  select: { type: 'string', short: 's' },
  playlist: { type: 'boolean' },
  'no-metadata': { type: 'boolean' },
  'no-thumbnail': { type: 'boolean' },
  subs: { type: 'boolean' },
  'cookies-from-browser': { type: 'string' },
  cookies: { type: 'string' },
  title: { type: 'string' },
  artist: { type: 'string' },
  album: { type: 'string' },
  comment: { type: 'string' },
  'bin-dir': { type: 'string' },
  json: { type: 'boolean' },
  quiet: { type: 'boolean', short: 'q' },
  force: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' }
} as const

function cookieBrowser(v: string | undefined): CookieBrowser | undefined {
  if (v === undefined) return undefined
  const r = CookieBrowserSchema.safeParse(v)
  if (!r.success) throw new UsageError(`--cookies-from-browser に指定できないブラウザです: ${v}`)
  return r.data
}

/** argv（process.argv.slice(2)）を解釈する。不正な指定は UsageError。 */
export function parseCliArgs(argv: string[]): CliCommand {
  let parsed: ReturnType<typeof parseArgs<{ options: typeof OPTIONS; allowPositionals: true }>>
  try {
    parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true })
  } catch (e) {
    throw new UsageError(e instanceof Error ? e.message : String(e))
  }
  const { values: v, positionals } = parsed
  if (v.help) return { kind: 'help' }
  if (v.version) return { kind: 'version' }

  const [first, ...restPos] = positionals
  const sub = first && SUBCOMMANDS.has(first) ? first : 'download'
  const args = sub === 'download' && first !== 'download' ? positionals : restPos
  const binDir = v['bin-dir']

  switch (sub) {
    case 'formats':
      return { kind: 'formats' }
    case 'setup':
      return { kind: 'setup', force: !!v.force, binDir }
    case 'update':
      return { kind: 'update', binDir }
    case 'info':
      if (args.length !== 1) throw new UsageError('info には URL を 1 つ指定してください。')
      return {
        kind: 'info',
        url: args[0],
        json: !!v.json,
        binDir,
        cookiesFromBrowser: cookieBrowser(v['cookies-from-browser']),
        cookiesFile: v.cookies
      }
  }

  if (args.length === 0) throw new UsageError('URL を指定してください。')
  if (v.format !== undefined && !isOutputFormat(v.format)) {
    throw new UsageError(`未対応の出力形式です: ${v.format}（指定可能: ${OUTPUT_FORMATS.join(', ')}）`)
  }
  const metadata: MetadataOverride = {}
  if (v.title !== undefined) metadata.title = v.title
  if (v.artist !== undefined) metadata.artist = v.artist
  if (v.album !== undefined) metadata.album = v.album
  if (v.comment !== undefined) metadata.comment = v.comment

  return {
    kind: 'download',
    urls: args,
    json: !!v.json,
    quiet: !!v.quiet,
    binDir,
    spec: {
      outputDir: v.output ?? '.',
      format: v.format,
      filenameTemplate: v.name,
      formatSelector: v.select,
      playlist: !!v.playlist,
      embedMetadata: !v['no-metadata'],
      embedThumbnail: !v['no-thumbnail'],
      subtitles: !!v.subs,
      cookiesFromBrowser: cookieBrowser(v['cookies-from-browser']),
      cookiesFile: v.cookies,
      metadata: Object.keys(metadata).length > 0 ? metadata : undefined
    }
  }
}
