# @liasvistreamgamemusic-sketch/media-dl

URL・出力形式・保存先を指定するだけで、メディアをファイルとして保存するライブラリ兼 CLI です。
取得は [yt-dlp](https://github.com/yt-dlp/yt-dlp)、結合と変換は ffmpeg に任せます。そのため YouTube に限らず、
yt-dlp が対応するサイト（SoundCloud・ニコニコ動画・Vimeo・X など）と、mp4 / m3u8 の直リンク、
`<video>` を埋め込んだ一般のページを扱えます。

- Node.js 20.19 以上（ESM。Node 22 以降は `require()` でも読み込めます）
- Windows x64 / macOS (Intel・Apple Silicon) / Linux x64・arm64

## 導入

npm にはまだ公開していないため、GitHub Release に添付している tarball から入れます。

```bash
npm install https://github.com/liasvistreamgamemusic-sketch/media-download/releases/download/<tag>/liasvistreamgamemusic-sketch-media-dl-<version>.tgz
npx media-dl setup   # yt-dlp / ffmpeg / ffprobe / deno をユーザーキャッシュに導入（初回のみ）
```

`setup` は不足しているものだけを取得します。ffmpeg や deno が既に PATH にあれば、それを使います。
yt-dlp は常に最新版を取得します。

## CLI

```bash
media-dl <URL> -f mp3 -o ./music          # 保存したファイルの絶対パスを標準出力に出す
media-dl <URL1> <URL2> -f mp4 -o ./videos # 複数 URL を順に取得する
media-dl <URL> -f flac --playlist         # プレイリストを全件取得する
media-dl <URL> --json                     # 進捗と結果を 1 行 1 JSON（NDJSON）で出す
media-dl info <URL> --json                # ダウンロードせずに情報だけ取る
media-dl formats                          # 指定できる出力形式の一覧
media-dl update                           # yt-dlp を更新する
```

終了コードは、成功 0、失敗 1、引数の誤り 2、Ctrl+C による中断 130 です。
Python などの別言語からは、このコマンドを子プロセスとして呼び、`--json` の出力を読む使い方を想定しています。

`--json` の出力例:

```json
{"type":"progress","url":"…","status":"downloading","percent":33.2,"downloadedBytes":15360,"totalBytes":46172,"speedBps":6128663,"etaSec":0}
{"type":"done","url":"…","files":["/abs/path/曲名 [id].mp3"],"warnings":[]}
{"type":"error","url":"…","code":"UNAVAILABLE","userMessage":"コンテンツが見つからないか、非公開です。","detail":"ERROR: …"}
```

## ライブラリ

```ts
import { download, probe, MediaDownloader, MediaDownloadError } from '@liasvistreamgamemusic-sketch/media-dl'

const { files, warnings } = await download({
  url: 'https://example.com/watch/123',
  format: 'mp3',
  outputDir: './out',
  onProgress: (p) => console.log(p.status, p.percent)
})

// 何度も呼ぶ場合はインスタンスを使い回す（バイナリの探索が 1 回で済む）
const dl = new MediaDownloader()
const info = await dl.probe(url)            // タイトル・映像/音声の有無・フォーマット一覧
const ac = new AbortController()
await dl.download({ url, outputDir: './out', signal: ac.signal })  // ac.abort() で中断
```

失敗すると `MediaDownloadError` を投げます。`code` で原因を判定できます
（`INVALID_INPUT` / `ENGINE_MISSING` / `FFMPEG_MISSING` / `UNSUPPORTED_URL` / `UNAVAILABLE` / `GEO_BLOCKED` /
`AGE_RESTRICTED` / `AUTH_REQUIRED` / `NETWORK` / `ENGINE_OUTDATED` / `DISK` / `CANCELLED` / `UNKNOWN`）。

### 主なオプション（`download`）

| 項目 | 既定 | 説明 |
|---|---|---|
| `url` | （必須） | http / https のみ |
| `outputDir` | （必須） | 保存先。無ければ作成する |
| `format` | `mp4` | 下表のいずれか |
| `formatSelector` | — | yt-dlp の `-f` 選択式（例 `bv*[height<=720]+ba/b`）。画質の上限指定などに使う |
| `filenameTemplate` | `%(title).150B [%(id)s].%(ext)s` | yt-dlp の `-o` 構文。`outputDir` からの相対のみ（絶対パスと `..` は拒否） |
| `playlist` | `false` | プレイリストを全件取得する |
| `embedMetadata` / `embedThumbnail` | `true` | サムネイルは非対応の形式（webm / wav / best）では自動で埋め込まない |
| `subtitles` | `false` | 字幕（全言語）を別ファイルで保存する |
| `cookiesFromBrowser` / `cookiesFile` | — | ログインが必要なサイト用 |
| `metadata` | — | `{ title, artist, album, comment }` で埋め込みタグを上書きする |

### 出力形式

| 形式 | 内容 |
|---|---|
| `mp4` / `mkv` | 最高画質の映像と音声を結合し、指定のコンテナにそろえる |
| `webm` | webm 同士を優先して結合する。合わなければ webm へ再エンコードする |
| `best` | 最高画質を元のコンテナのまま保存する |
| `mp3` / `m4a` / `opus` | 音声のみを最高の VBR 品質で変換する |
| `flac` / `wav` / `alac` | 音声のみを可逆・非圧縮で変換する（`alac` は `.m4a`） |
| `audio` | 音声のみを元のコーデックのまま保存する（再エンコードなし） |

## バイナリの探し方

項目ごとに、次の順で最初に見つかったものを使います。明示指定や環境変数のパスが存在しない場合は、
ほかを探さずにエラーにします。

1. コンストラクタの引数 `new MediaDownloader({ ytDlp, ffmpegDir, deno, binDir })`
2. 環境変数

   | 変数 | 内容 |
   |---|---|
   | `MEDIA_DL_YTDLP` | yt-dlp 実行ファイルのパス |
   | `MEDIA_DL_FFMPEG_DIR` | ffmpeg（と ffprobe）があるディレクトリ |
   | `MEDIA_DL_DENO` | deno 実行ファイルのパス |
   | `MEDIA_DL_BIN_DIR` | `setup` の導入先 兼 探索先 |

3. `setup` の導入先（既定: Windows `%LOCALAPPDATA%\media-dl\bin`、macOS `~/Library/Caches/media-dl/bin`、
   Linux `$XDG_CACHE_HOME/media-dl/bin` または `~/.cache/media-dl/bin`）
4. PATH（と `/opt/homebrew/bin`・`/usr/local/bin`・`/usr/bin`）

## 注意

- DRM で保護された配信（Netflix など）は取得できません。
- 取得してよいかどうかは、各サイトの利用規約と著作権法に従って利用者が判断してください。
- `setup` が取得する ffmpeg は [ffmpeg-static](https://github.com/eugeneware/ffmpeg-static) の配布物です。
  ライセンス（GPL）の条件は、配布元で確認してください。
- yt-dlp 2026.11.23 には、`--audio-format alac` を指定しても AAC で出力される不具合があります。
  `alac` 形式では、エンコーダを明示してこれを回避しています。
