# Media Downloader 実装指示書（Claude Code 向け / シニア設計版）

> URL を貼り付けるだけで、YouTube・SoundCloud・ニコニコ動画・CloudFront 等から高品質なメディアをローカル保存できる **Windows デスクトップアプリ**。
> このドキュメントは AI コーディングエージェント（Claude Code）に渡して実装させることを前提とした、設計・契約・受け入れ基準を含む実装指示書です。

---

## 0. このドキュメントの読み方（実装エージェントへの前提）

実装に入る前に、以下を「鉄則」として全工程で守ること。

- **仕様の自前推測でハードコードしない。** yt-dlp / ffmpeg の引数・出力フォーマット・テンプレート構文は、実装時に必ず `yt-dlp --help`、`yt-dlp -v <URL>` の実出力で確認してから固定すること。本書に書かれたフラグ・テンプレート・正規表現は「確認済みの初期値」ではなく「検証して採用すべき候補」として扱う。
- **サイトごとの特別処理を書かない。** 対応サイトの追従は yt-dlp が行う。アプリは「サイト判定済みの `extractor` 名」と「`probe` で得た映像/音声の有無」を見て振る舞いを変えるだけにする。サイト名で `if` 分岐を増やさない（唯一の例外＝音声のみソースで動画モードを無効化、これも probe 結果から導出する）。
- **子プロセスは必ず配列引数で起動する。** シェル文字列の連結は禁止（コマンドインジェクション対策、6 章・13 章参照）。
- **純粋関数とI/Oを分離する。** 引数組み立て・進捗パース・エラー分類は副作用のない純粋関数にし、ユニットテストを書く（15 章）。
- **型は1箇所で定義する。** ドメイン型と IPC 契約は `src/shared/` に集約し、main / preload / renderer で共有する（7.2）。

---

## 1. 製品概要・目的

- ユーザーが動画/音声の URL を貼り付けるだけで、最高品質のメディアをローカルに保存できる GUI アプリ。
- CLI に不慣れな利用者でも使えること。
- 対象 OS は **Windows 10 / 11（64bit）** のみ。他 OS は考慮しない。
- ダウンロードの実処理は自前実装せず **yt-dlp** に委譲し、結合・変換は **ffmpeg** に委譲する。アプリ本体は「UI ＋ エンジンを安全・適切に呼び出すラッパー」と位置づける。

---

## 2. 設計原則

このアプリの品質の大半は「yt-dlp との境界をどう設計するか」で決まる。原則は次のとおり。

- **単一責任・依存方向の固定**：UI（Renderer）→ IPC → アプリケーション層（Main）→ メディアエンジン層 → 子プロセス、の一方向。逆流させない。Renderer から直接バイナリを叩かない。
- **エンジンの抽象化**：`MediaEngine` インターフェース越しにのみ yt-dlp を使う。実装（`YtDlpEngine`）はモック可能にし、UI/アプリ層はインターフェースに依存する。
- **構造化データを使う**：人間向け表示（`-F` のテキスト、`[download] 62%` 行）をパースしない。`--dump-single-json` と `--progress-template` で機械可読データを得る。
- **サイト非依存**：振る舞いは probe 結果から導出する。サイト個別ロジックを禁止する。
- **失敗を型で扱う**：エラーは生ログのまま投げず、`AppErrorCode` に分類してから UI に渡す。未分類は `UNKNOWN` とし生ログを「詳細」で見せる。
- **ロケール配慮**：日本語タイトルを壊さない（`--restrict-filenames` は使わない、8.3 参照）。

---

## 3. スコープと対応サービス

### 3.1 対応する入力

- **yt-dlp が対応するサイト全般**（数千サイト）。サイト追従は yt-dlp 側で行われる。
- **SoundCloud（必須要件）**：単曲・セット（プレイリスト）・ユーザーページ。音声のみ。
- **ニコニコ動画**：日本ユーザー向けに対応（一部は要ログイン、12 章・8.5 の Cookie 連携で対応可能）。
- **CloudFront / 直リンク**：`.mp4` 等の静的ファイル直 URL。
- **CloudFront / HLS**：`.m3u8` 等。yt-dlp + ffmpeg がセグメントを自動結合する。

### 3.2 テスト対象サービス（受け入れ確認のマトリクス）

最低限、以下を実機確認すること。各サービスで「probe → 種別選択 → ダウンロード成功」を通す。

| サービス | 想定メディア | 確認観点 |
|---|---|---|
| YouTube | 動画+音声 | 映像音声結合、年齢制限の分類 |
| SoundCloud（必須） | 音声のみ | 動画モードが自動で無効化されること、セットの扱い |
| ニコニコ動画 | 動画+音声 | 日本語タイトル、要ログイン時のエラー分類 |
| Vimeo | 動画+音声 | 高解像度フォーマット |
| X（Twitter） | 動画+音声 | 短尺・複数フォーマット |
| TikTok | 動画+音声 | ウォーターマーク有無 |
| Twitch（VOD） | 動画+音声 | 長尺、HLS |
| 直リンク / HLS（CloudFront 想定） | 任意 | `.mp4` 直 URL と `.m3u8` の双方 |

### 3.3 対象外

- **DRM 保護されたストリーミング**（一般的な有料配信サービス等）。yt-dlp も基本的に取得しないため、対象外として明示する。

---

## 4. 技術スタック

### 4.1 推奨構成（第一候補）

| 要素 | 採用技術 | 理由 |
|---|---|---|
| 雛形/ビルド基盤 | **electron-vite + Electron + TypeScript + React** | main/preload/renderer 構成を最初から型安全に分離でき、開発時 HMR と本番ビルドが速い |
| 状態管理 | React の `useState` / `useReducer` / Context | 規模的に十分。過剰な依存を避ける |
| 子プロセス実行 | **`execa`** | spawn・stdout 監視・`AbortSignal` によるキャンセルを型安全に扱える |
| ランタイム検証 | **`zod`** | URL 入力・設定・yt-dlp の JSON 出力・IPC ペイロードの境界検証に使う |
| 設定永続化 | **`electron-store`**（zod スキーマで検証） | クロスバージョンで安全。手書き JSON I/O を避ける |
| パッケージング | **`electron-builder`**（NSIS または portable） | Windows 配布の定番 |
| ダウンロードエンジン | **yt-dlp.exe**（同梱） | 中核。16 章の方法でバンドル |
| メディア処理 | **ffmpeg.exe / ffprobe.exe**（同梱） | 結合・変換に必須 |

### 4.2 代替（任意）

- Electron が重い場合は **Tauri（Rust + Web フロント）** でも実現可能。フロントの TypeScript 資産はほぼ流用できる。
- 採用判断は実装側でよいが、**まず electron-vite 構成で実装する**こと。

---

## 5. アーキテクチャ

```
┌──────────────────────────────────────────────────────────┐
│ Renderer (React / TypeScript)                              │
│   URL 入力・probe 起動・種別/品質選択・進捗表示・保存先設定    │
│   window.api (preload が公開する型付き API) 経由でのみ通信     │
└───────────────────────────┬──────────────────────────────┘
                            │ 型付き IPC（shared/ipc.ts の契約）
┌───────────────────────────▼──────────────────────────────┐
│ Main / アプリケーション層 (Node / TypeScript)               │
│   IPC ハンドラ・ジョブキュー・状態機械・設定・ロガー          │
└───────────────────────────┬──────────────────────────────┘
                            │ MediaEngine インターフェース
┌───────────────────────────▼──────────────────────────────┐
│ メディアエンジン層（共通化の核 / 7 章）                       │
│   YtDlpEngine = buildArgs(純) + runProcess + parseProgress(純)│
│                 + classifyError(純) + parseMediaInfo(純/zod)  │
└───────────────────────────┬──────────────────────────────┘
                            │ spawn（配列引数のみ）
                ┌───────────▼──────────┐   ┌──────────────┐
                │      yt-dlp.exe       │──▶│  ffmpeg.exe   │
                └──────────────────────┘   └──────────────┘
```

**Electron セキュリティ前提（必須）**：`contextIsolation: true` / `nodeIntegration: false` / `sandbox: true`。preload は `contextBridge` 経由で必要最小の API のみを公開する。

### モジュール責務

| 層 | モジュール | 責務 |
|---|---|---|
| shared | `types.ts` / `ipc.ts` | ドメイン型・エラー型・IPC チャンネル名とペイロード型（唯一の真実） |
| engine | `MediaEngine.ts` | エンジンのインターフェース定義 |
| engine | `YtDlpEngine.ts` | インターフェース実装。下記の純粋関数群を束ねる |
| engine | `buildArgs.ts` | リクエスト → yt-dlp 引数配列（**純粋関数**） |
| engine | `runProcess.ts` | execa で起動・行ストリーム・キャンセル・ツリー kill |
| engine | `parseProgress.ts` | progress 行 → `DownloadProgress`（**純粋関数**） |
| engine | `classifyError.ts` | stderr → `AppError`（**純粋関数**） |
| engine | `parseMediaInfo.ts` | yt-dlp JSON → `MediaInfo`（**純粋関数 + zod**） |
| main | `JobQueue.ts` | ジョブの状態機械・直列/並列実行・キャンセル |
| main | `ipcHandlers.ts` | IPC 受け口。`window.api` の裏側 |
| main | `paths.ts` | バイナリのパス解決（開発/本番） |
| main | `settings.ts` | 設定の読み書き（electron-store + zod） |
| main | `logger.ts` | 構造化ログ・ログファイル出力 |
| preload | `preload.ts` | `contextBridge` で型付き `window.api` を公開 |
| renderer | `App.tsx` ほか | UI |

---

## 6. 【中核】メディアエンジン層（共通化の本体）

ここが本アプリの心臓部であり、共通化のすべて。yt-dlp の呼び出しは **この層の内側だけ**に閉じ込める。

### 6.1 全体像

`YtDlpEngine` は「設定オブジェクトを受け取り → 純粋関数で引数を組み立て → プロセスを起動し → 出力を純粋関数でパース → 型付きの結果/エラーを返す」だけの薄い実装にする。サイト固有の知識を持たせない。

### 6.2 インターフェース

```ts
// engine/MediaEngine.ts
export interface MediaEngine {
  /** URL を解析して構造化情報を返す（--dump-single-json） */
  probe(url: string, opts?: ProbeOptions): Promise<MediaInfo>;

  /** 実ダウンロード。進捗は onProgress、中断は signal で */
  download(
    req: DownloadRequest,
    hooks: { onProgress: (p: DownloadProgress) => void; signal: AbortSignal },
  ): Promise<DownloadResult>;

  /** yt-dlp のバージョン文字列 */
  engineVersion(): Promise<string>;

  /** yt-dlp 自己更新（注意点は 16.3 参照） */
  updateEngine(): Promise<string>;
}
```

### 6.3 引数ビルダ（純粋関数）

リクエストとパス情報のみから引数配列を返す。I/O も乱数も時刻も使わない＝完全にテスト可能。

```ts
// engine/buildArgs.ts
import path from 'node:path';

const BASE_FLAGS = [
  '--ignore-config',     // ユーザー環境の設定に影響されない
  '--no-color',
  '--newline',
  '--no-mtime',
  '--windows-filenames', // 不正文字を除去（日本語は保持。--restrict-filenames は使わない）
  '-N', '4',             // HLS 等のフラグメント並列取得
  '--retries', '10',
  '--fragment-retries', '10',
];

// 機械可読な進捗（| 区切り）。フィールド名は実装時に yt-dlp --help で確認すること。
export const PROGRESS_TEMPLATE =
  'download:[PROG]|%(progress.status)s|%(progress.downloaded_bytes)s' +
  '|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s' +
  '|%(progress.speed)s|%(progress.eta)s';

export function buildDownloadArgs(req: DownloadRequest, paths: BinPaths): string[] {
  const out = path.join(req.outputDir, '%(title).150B [%(id)s].%(ext)s');
  // ※ %(title).150B のバイト長制限構文は実装時に出力テンプレート仕様で確認

  const args = [
    ...BASE_FLAGS,
    '--ffmpeg-location', paths.ffmpegDir,
    '--progress-template', PROGRESS_TEMPLATE,
    '-o', out,
  ];

  switch (req.kind) {
    case 'video_best':
      args.push('-f', req.formatId ?? 'bv*+ba/b', '--merge-output-format', 'mp4');
      break;
    case 'audio_mp3':
      args.push('-x', '--audio-format', 'mp3', '--audio-quality', '0');
      if (req.formatId) args.push('-f', req.formatId);
      break;
    case 'audio_lossless':
      args.push('-f', req.formatId ?? 'ba/b'); // 再エンコードせず元コーデック維持
      break;
  }

  if (req.embedMetadata) args.push('--embed-metadata');
  if (req.embedThumbnail) args.push('--embed-thumbnail');
  if (req.writeSubs) args.push('--write-subs', '--sub-langs', 'all');
  if (req.noPlaylist) args.push('--no-playlist');
  if (req.cookiesFromBrowser) args.push('--cookies-from-browser', req.cookiesFromBrowser);

  args.push('--', req.url); // -- で以降を引数として確定（URL がハイフン始まりでも安全）
  return args;
}
```

### 6.4 プロセス実行（キャンセルとツリー kill）

```ts
// engine/runProcess.ts
import { execa } from 'execa';

export async function runYtDlp(
  binPath: string,
  args: string[],
  onLine: (line: string, stream: 'out' | 'err') => void,
  signal: AbortSignal,
): Promise<{ exitCode: number; stderr: string }> {
  const child = execa(binPath, args, {
    windowsHide: true,
    buffer: false,
    encoding: 'utf8',
  });

  // 行単位でストリーミング
  bindLineReader(child.stdout, (l) => onLine(l, 'out'));
  bindLineReader(child.stderr, (l) => onLine(l, 'err'));

  // キャンセル：yt-dlp は ffmpeg を子プロセスとして起動するため、
  // 単純な kill では ffmpeg が孤児化する。Windows ではツリーごと kill する。
  const onAbort = () => {
    if (child.pid) {
      // execa({ windowsHide: true }) + taskkill /T で子孫まで終了
      void execa('taskkill', ['/PID', String(child.pid), '/T', '/F']).catch(() => {});
    }
  };
  signal.addEventListener('abort', onAbort, { once: true });

  try {
    const res = await child;
    return { exitCode: res.exitCode ?? 0, stderr: res.stderr ?? '' };
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}
```

> ⚠️ **孤児 ffmpeg 問題**は本構成で最も起きやすいバグ。キャンセルおよびアプリ終了時に、起動したプロセスツリーが確実に終了することをテスト（15 章）で担保すること。

### 6.5 進捗パーサ（純粋関数）

`PROGRESS_TEMPLATE` が出す `[PROG]|...` 行のみを解釈する。`NA` は `null` に正規化する。

```ts
// engine/parseProgress.ts
export function parseProgressLine(line: string, jobId: string): DownloadProgress | null {
  if (!line.startsWith('[PROG]|')) return null;
  const [, status, dl, total, est, speed, eta] = line.split('|');
  const num = (v: string) => (v === 'NA' || v === '' ? null : Number(v));

  const downloadedBytes = num(dl);
  const totalBytes = num(total) ?? num(est); // total が NA なら推定値
  const percent =
    downloadedBytes != null && totalBytes ? Math.min(100, (downloadedBytes / totalBytes) * 100) : null;

  return {
    jobId,
    status: status === 'finished' ? 'postprocessing' : status === 'error' ? 'failed' : 'downloading',
    percent,
    downloadedBytes,
    totalBytes,
    speedBps: num(speed),
    etaSec: num(eta),
  };
}
```

> フォールバック：万一テンプレートが機能しない環境向けに、`/\[download\]\s+(\d+\.\d+)%/` で % だけ拾う簡易パーサも用意してよい。ただし主経路は progress-template とする。

### 6.6 エラー分類（純粋関数）

stderr を `AppErrorCode` にマッピングする。正規表現はあくまで**ヒューリスティック**であり、yt-dlp の文言変更で陳腐化しうる。未一致は `UNKNOWN` とし、必ず生ログを保持する。

```ts
// engine/classifyError.ts
const RULES: Array<{ test: RegExp; code: AppErrorCode; msg: string }> = [
  { test: /Unsupported URL|is not a valid URL/i,                code: 'UNSUPPORTED_URL', msg: 'この URL には対応していません。' },
  { test: /Video unavailable|is (private|unavailable)|not found/i, code: 'UNAVAILABLE',  msg: 'コンテンツが見つからないか、非公開です。' },
  { test: /not available in your country|geo.?restrict/i,       code: 'GEO_BLOCKED',     msg: 'お住まいの地域では取得できないコンテンツです。' },
  { test: /confirm your age|age.?restrict/i,                    code: 'AGE_RESTRICTED',  msg: '年齢制限コンテンツです。ブラウザのログイン情報(Cookie)が必要な場合があります。' },
  { test: /login required|requires authentication|HTTP Error 40[13]/i, code: 'AUTH_REQUIRED', msg: 'ログインが必要なコンテンツです。' },
  { test: /ffmpeg.*not.*found|ffprobe.*not.*found/i,            code: 'FFMPEG_MISSING',  msg: '変換用コンポーネント(ffmpeg)が見つかりません。' },
  { test: /getaddrinfo|timed out|Connection.*(refused|reset)|Unable to download/i, code: 'NETWORK', msg: 'ネットワークに接続できません。' },
  { test: /No space left|not enough space/i,                    code: 'DISK',            msg: '保存先の空き容量が不足しています。' },
  { test: /Please update|out.?of.?date/i,                       code: 'ENGINE_OUTDATED', msg: 'エンジンの更新が必要かもしれません（更新ボタン）。' },
];

export function classifyError(stderr: string): AppError {
  for (const r of RULES) if (r.test.test(stderr)) return { code: r.code, userMessage: r.msg, detail: stderr };
  return { code: 'UNKNOWN', userMessage: '不明なエラーが発生しました。詳細をご確認ください。', detail: stderr };
}
```

### 6.7 情報取得（dump-json → zod → MediaInfo）

`-F` のテキストではなく **`--dump-single-json`** を使い、zod で検証してから `MediaInfo` に写像する。映像/音声の有無（capability）はここで判定する。

```ts
// engine/parseMediaInfo.ts
import { z } from 'zod';

const RawFormat = z.object({
  format_id: z.string(),
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
}).passthrough();

const RawInfo = z.object({
  id: z.string(),
  title: z.string(),
  uploader: z.string().nullish(),
  duration: z.number().nullish(),
  thumbnail: z.string().nullish(),
  webpage_url: z.string(),
  extractor: z.string(),
  _type: z.string().nullish(),          // 'playlist' 等
  entries: z.array(z.any()).nullish(),  // プレイリスト時
  formats: z.array(RawFormat).nullish(),
}).passthrough();

const has = (v?: string | null) => !!v && v !== 'none';

export function parseMediaInfo(json: unknown): MediaInfo {
  const raw = RawInfo.parse(json);
  const isPlaylist = raw._type === 'playlist' || Array.isArray(raw.entries);
  const formats = (raw.formats ?? []).map((f) => ({
    formatId: f.format_id,
    ext: f.ext,
    resolution: f.width && f.height ? `${f.width}x${f.height}` : null,
    fps: f.fps ?? null,
    vcodec: has(f.vcodec) ? f.vcodec! : null,
    acodec: has(f.acodec) ? f.acodec! : null,
    abr: f.abr ?? null,
    tbr: f.tbr ?? null,
    filesize: f.filesize ?? f.filesize_approx ?? null,
    isVideo: has(f.vcodec),
    isAudio: has(f.acodec),
    note: f.format_note ?? null,
  }));

  return {
    id: raw.id,
    title: raw.title,
    uploader: raw.uploader ?? null,
    durationSec: raw.duration ?? null,
    thumbnailUrl: raw.thumbnail ?? null,
    webpageUrl: raw.webpage_url,
    extractor: raw.extractor,
    isPlaylist,
    playlistCount: raw.entries?.length ?? null,
    hasVideo: formats.some((f) => f.isVideo),   // ← SoundCloud は false
    hasAudio: formats.some((f) => f.isAudio),
    formats,
  };
}
```

> 大規模プレイリストは `-J` 単体だと各エントリ抽出で遅くなる。一覧表示には `--flat-playlist --dump-single-json` で高速にタイトルだけ取得し、個別 probe は選択時に遅延実行すること。

---

## 7. 共有型と IPC 契約

### 7.1 ドメイン型（`src/shared/types.ts`）

```ts
export type DownloadKind = 'video_best' | 'audio_mp3' | 'audio_lossless';

export interface FormatOption {
  formatId: string; ext: string;
  resolution: string | null; fps: number | null;
  vcodec: string | null; acodec: string | null;
  abr: number | null; tbr: number | null; filesize: number | null;
  isVideo: boolean; isAudio: boolean; note: string | null;
}

export interface MediaInfo {
  id: string; title: string; uploader: string | null;
  durationSec: number | null; thumbnailUrl: string | null;
  webpageUrl: string; extractor: string;
  isPlaylist: boolean; playlistCount: number | null;
  hasVideo: boolean; hasAudio: boolean;   // capability フラグ（UI 適応に使う）
  formats: FormatOption[];
}

export type JobStatus =
  | 'queued' | 'analyzing' | 'downloading'
  | 'postprocessing' | 'completed' | 'failed' | 'cancelled';

export interface DownloadProgress {
  jobId: string; status: JobStatus;
  percent: number | null; downloadedBytes: number | null; totalBytes: number | null;
  speedBps: number | null; etaSec: number | null;
}

export interface DownloadRequest {
  url: string; kind: DownloadKind;
  formatId?: string;            // 明示選択時のみ。おまかせなら undefined
  outputDir: string;
  embedMetadata?: boolean; embedThumbnail?: boolean; writeSubs?: boolean;
  noPlaylist?: boolean;
  cookiesFromBrowser?: 'chrome' | 'edge' | 'firefox' | null;
}

export interface DownloadResult { jobId: string; outputPath: string; }

export type AppErrorCode =
  | 'UNSUPPORTED_URL' | 'UNAVAILABLE' | 'GEO_BLOCKED' | 'AGE_RESTRICTED'
  | 'NETWORK' | 'AUTH_REQUIRED' | 'FFMPEG_MISSING' | 'ENGINE_OUTDATED'
  | 'DISK' | 'CANCELLED' | 'UNKNOWN';

export interface AppError { code: AppErrorCode; userMessage: string; detail: string; }

export interface Settings {
  outputDir: string;
  defaultKind: DownloadKind;
  embedMetadata: boolean; embedThumbnail: boolean;
  disclaimerAccepted: boolean;
  cookiesFromBrowser: DownloadRequest['cookiesFromBrowser'];
}
```

### 7.2 IPC 契約（`src/shared/ipc.ts`）

```ts
export const IPC = {
  PROBE: 'media:probe',                 // (url) => MediaInfo
  DOWNLOAD_START: 'media:download:start',// (DownloadRequest) => jobId
  DOWNLOAD_CANCEL: 'media:download:cancel', // (jobId) => void
  PROGRESS: 'media:progress',           // main → renderer: DownloadProgress
  JOB_DONE: 'media:job:done',           // main → renderer: DownloadResult | AppError
  PICK_FOLDER: 'dialog:pickFolder',     // () => string | null
  OPEN_FOLDER: 'shell:openFolder',      // (path) => void
  GET_SETTINGS: 'settings:get',         // () => Settings
  SET_SETTINGS: 'settings:set',         // (Partial<Settings>) => Settings
  ENGINE_VERSION: 'engine:version',     // () => string
  ENGINE_UPDATE: 'engine:update',       // () => string
} as const;
```

preload は上記契約を `window.api`（型付き）として公開し、Renderer は `ipcRenderer` を直接触らない。Main 側ハンドラは、受け取った引数を **zod で必ず検証**してから処理する（13 章）。

---

## 8. yt-dlp 連携の品質方針

### 8.1 種別と推奨フォーマット式

| 種別 | フォーマット式 | 結果 |
|---|---|---|
| 動画（最高画質・音声付き） | `-f "bv*+ba/b" --merge-output-format mp4` | 最高映像＋最高音声を ffmpeg で結合。単一ストリームのみなら `b` にフォールバック |
| 音声 mp3（最高音質） | `-x --audio-format mp3 --audio-quality 0` | ffmpeg で mp3 変換 |
| 音声 無劣化（元コーデック維持） | `-f "ba/b"` | 再エンコードせず元音声（多くは m4a/opus）を保存。**音質劣化なし**。最高音質重視ならこちら |

### 8.2 capability ベースの UI 適応（多サービス対応の肝）

probe 後、`MediaInfo.hasVideo` / `hasAudio` を見てUIと既定値を切り替える。

- `hasVideo === false`（例：**SoundCloud**）→「動画」種別を非表示/無効化し、既定を「音声 無劣化」にする。
- `hasVideo === true` → 3 種別すべて選択可能。既定は設定の `defaultKind`。
- `isPlaylist === true` → プレイリスト取り込みの確認と「単曲のみ（`--no-playlist`）」トグルを出す。

### 8.3 日本語ファイル名（ロケール配慮・重要）

- **`--restrict-filenames` は使わない**（日本語・記号が ASCII に潰され、タイトルが読めなくなる）。
- 代わりに **`--windows-filenames`** で Windows 禁止文字のみ除去し、Unicode を保持する。
- 出力テンプレートは `%(title).150B [%(id)s].%(ext)s` 等でタイトル長を制限し、ID で衝突を回避する（長さ制限の構文は実装時に確認）。

### 8.4 SoundCloud 具体仕様（必須要件）

- 単曲 URL → 音声のみ。`audio_lossless`（`ba/b`）または `audio_mp3`。アートワークは `--embed-thumbnail --embed-metadata` で付与可能（mp3 は ID3 として）。
- セット/プレイリスト URL → 全曲取得。`-o "%(playlist_title)s/%(playlist_index)02d - %(title)s.%(ext)s"` でフォルダ整理。単曲のみ欲しい場合は `--no-playlist`。
- Go+ 等の有料/限定音源は要ログインで取得不可のことがある → `AUTH_REQUIRED` に分類。必要なら 8.5 の Cookie 連携。

### 8.5 認証が必要なサイトへの対応（任意・プライバシー注意）

- 年齢制限 YouTube、ニコニコ会員限定、SoundCloud Go+ 等は `--cookies-from-browser <chrome|edge|firefox>` でブラウザの Cookie を利用できる。
- これは利用者のログイン情報を使う機能であるため、**既定では無効**とし、設定で明示的に有効化させる。UI に「ブラウザのログイン情報を利用する」旨と対象ブラウザ選択を出す。Cookie をアプリ外へ送信・保存しないこと。

### 8.6 CloudFront / 直リンク・HLS

- 静的ファイル直 URL は yt-dlp でそのまま取得できる。yt-dlp が扱えない単純 URL に限り、Node の HTTP ストリーム保存へフォールバックする分岐を用意してよい（任意）。
- HLS（`.m3u8`）は yt-dlp がセグメント取得＋ffmpeg 結合を自動で行うため特別処理不要。`-N 4` で並列取得が効く。

---

## 9. ジョブの状態機械とキュー

ダウンロードは1件でも、最初から状態機械として実装し、後からキュー（連続DL）へ拡張できる形にする。

```
queued → analyzing → downloading → postprocessing → completed
                          │                              
                          ├────────────► failed   （AppError）
                          └────────────► cancelled（AbortSignal）
```

- `JobQueue` は各ジョブに `AbortController` を持たせ、キャンセル時に `abort()` → 6.4 のツリー kill。
- 失敗/キャンセル時は中間ファイル（`.part` 等）の後始末を行う。
- MVP は同時実行数 1（直列）。将来 N 並列にできるよう、実行ロジックは件数に依存しない設計にする。

---

## 10. 機能要件

### 10.1 必須（MVP）

1. URL 入力欄 ＋「解析（probe）」ボタン。
2. 解析後、`MediaInfo` から品質/フォーマット一覧を提示（おまかせ最高＋個別選択）。
3. 種別選択：動画（最高画質 mp4）／音声 mp3（最高音質）／音声 無劣化。**capability に応じて自動で取捨**（8.2）。
4. 保存先フォルダ選択（既定：ユーザーの「ダウンロード」フォルダ）。
5. 進捗バー（％・速度・残り時間）。`postprocessing`（結合/変換）中は「変換中…」を表示。
6. 完了通知 ＋「保存先フォルダを開く」。
7. エラー時、`AppError.userMessage` を表示し、「詳細」で `detail`（生ログ）を確認可能にする。
8. 初回起動時の免責モーダル（11.2）。

### 10.2 あると良い（任意）

- 複数 URL のキュー処理（連続ダウンロード）。
- メタデータ・サムネイル埋め込みトグル（`--embed-metadata --embed-thumbnail`）。
- エンジン更新ボタン（`yt-dlp -U`、注意点は 16.3）。
- 字幕ダウンロード（`--write-subs`）。
- ダウンロード履歴。
- ブラウザ Cookie 連携（8.5）。

---

## 11. UI 設計

### 11.1 基本画面

単一画面。進捗中は実行系ボタンを無効化し、キャンセルを表示。完了後に「フォルダを開く」を表示。

```
┌────────────────────────────────────────────┐
│  🎬 Media Downloader                         │
├────────────────────────────────────────────┤
│  URL: [_________________________] [解析]      │
│                                              │
│  種別: ( ) 動画(最高画質)   ← 音声のみソースでは  │
│        ( ) 音声 mp3          自動で無効化       │
│        (•) 音声 無劣化                         │
│                                              │
│  品質: [ おまかせ最高 ▼ ]   ← 解析後に一覧表示   │
│                                              │
│  保存先: [ C:\Users\...\Downloads ] [変更]     │
│                                              │
│  [ ダウンロード ]                              │
│                                              │
│  ▓▓▓▓▓▓▓▓░░░░░░  62%  3.2MB/s  残り 0:12      │
│  状態: ダウンロード中 / 変換中 …                │
└────────────────────────────────────────────┘
```

- デザインは過度に凝らず、可読性と操作の分かりやすさを優先する。
- probe 結果のタイトル・サムネイル・長さを表示すると親切（任意）。

### 11.2 免責モーダル（法的留意事項・必須実装）

> ⚠️ 本節はアプリ仕様の一部として必ず実装すること。

- 初回起動時にモーダルを表示し、同意（チェックボックス＋OK）を得るまで利用不可とする。
- 免責文に以下を含める：
  - 本アプリは技術的なダウンロード手段を提供するのみであること。
  - 各サイトの利用規約および著作権法を遵守する責任は利用者にあること。
  - 自分が権利を持つコンテンツ・許諾済みコンテンツ・パブリックドメイン等の合法的用途を想定していること。
  - 日本の著作権法では、違法アップロードされた著作物を違法と知りながらダウンロードする行為は私的使用目的でも規制対象となりうること。
- 同意状態は設定（`Settings.disclaimerAccepted`）に保存し、次回以降は再表示しない。メニューから再表示できるようにする。

---

## 12. エラーハンドリング（型付き taxonomy）

stderr を 6.6 の `classifyError` で `AppErrorCode` に分類し、UI には日本語文＋「詳細」を渡す。

| コード | 想定状況 | ユーザー向け文（例） |
|---|---|---|
| `UNSUPPORTED_URL` | 非対応 URL | この URL には対応していません。 |
| `UNAVAILABLE` | 削除/非公開 | コンテンツが見つからないか、非公開です。 |
| `GEO_BLOCKED` | 地域制限 | お住まいの地域では取得できないコンテンツです。 |
| `AGE_RESTRICTED` | 年齢制限 | 年齢制限コンテンツです。Cookie 連携が必要な場合があります。 |
| `AUTH_REQUIRED` | 要ログイン | ログインが必要なコンテンツです。 |
| `NETWORK` | 接続失敗/タイムアウト | ネットワークに接続できません。 |
| `FFMPEG_MISSING` | ffmpeg 不在 | 変換用コンポーネントが見つかりません。 |
| `ENGINE_OUTDATED` | 抽出失敗が頻発 | エンジンの更新が必要かもしれません（更新ボタン）。 |
| `DISK` | 空き容量不足 | 保存先の空き容量が不足しています。 |
| `UNKNOWN` | 未分類 | 不明なエラーです。詳細をご確認ください。 |

未分類でも必ず生ログを保持し、「詳細」で確認できるようにすること。

---

## 13. セキュリティ

- **コマンドインジェクション対策**：子プロセスは `execa(bin, argsArray)` の**配列引数**でのみ起動する。シェル経由（`shell: true` / 文字列連結）は禁止。URL 等のユーザー入力を引数文字列に補間しない。
- **URL 検証**：probe 前に zod で URL 形式を検証する（スキームは `http`/`https` のみ許可）。検証は Main 側（信頼境界の内側）でも行う。
- **Electron ハードニング**：`contextIsolation: true` / `nodeIntegration: false` / `sandbox: true`。preload は最小 API のみ公開。`webSecurity` を無効化しない。外部 URL は既定ブラウザで開く。
- **IPC 境界の検証**：Main の各ハンドラは受信ペイロードを zod で検証してから処理する。Renderer を信頼しない。
- **Cookie の扱い**：8.5 のブラウザ Cookie 連携は既定オフ。Cookie をアプリ外送信・永続保存しない。
- **保存先の検証**：出力ディレクトリが書き込み可能な実在パスであることを確認する。

---

## 14. 設定・永続化・ログ

- 設定は `electron-store` ＋ zod スキーマで管理し、`Settings` 型に一致させる。破損時はデフォルトにフォールバック。
- ログは `logger.ts` で構造化（時刻・レベル・jobId）し、`userData/logs/` に出力。エラー時の「詳細」表示はこのログと stderr を参照。
- yt-dlp/ffmpeg の生 stderr はジョブ単位で保持し、`AppError.detail` に格納する。

---

## 15. テスト戦略

純粋関数を中心にユニットテストを書く（Vitest 推奨）。実ネットワークに依存させない。

- `buildArgs`：各 `DownloadKind`・各オプションで期待引数配列を検証。`--restrict-filenames` を絶対に含めないこと、`--` で URL を確定していることを assert。
- `parseProgress`：`NA` 混在、total 欠落→estimate 採用、`finished`→postprocessing 遷移などをフィクスチャで検証。
- `classifyError`：代表 stderr サンプル（各サービスの実ログを fixture 化）→ 期待コード。未一致→`UNKNOWN`。
- `parseMediaInfo`：実 `--dump-single-json` 出力を fixture 化（YouTube=映像音声、**SoundCloud=音声のみ**、プレイリスト）。`hasVideo`/`hasAudio` の導出を検証。
- **プロセスのキャンセル/終了**：`runYtDlp` をダミーバイナリで起動 → abort → プロセスツリーが残らないことを検証（孤児 ffmpeg 回帰防止）。
- E2E（任意）：Playwright for Electron で「probe → DL → 完了」のハッピーパス。

---

## 16. ビルド・配布

### 16.1 electron-builder 設定（要点）

```jsonc
{
  "build": {
    "appId": "com.example.mediadownloader",
    "win": { "target": ["nsis"], "icon": "build/icon.ico" },
    "extraResources": [
      { "from": "resources/bin", "to": "bin", "filter": ["**/*"] }
    ]
  }
}
```

- `win.target` は `nsis`（インストーラ）または `portable`（単一 exe）。
- アイコン（`.ico`）を用意。
- 署名なし配布では Windows SmartScreen 警告が出る旨を README に明記。社内配布なら許容範囲、必要ならコードサイニング証明書を検討。

### 16.2 バイナリ同梱とパス解決

- `yt-dlp.exe` / `ffmpeg.exe` / `ffprobe.exe` を `resources/bin/` に置き `extraResources` で同梱。
- パス解決（`paths.ts`）：
  - 開発時：プロジェクト内 `resources/bin/`
  - 本番時：`process.resourcesPath` 配下 `bin/`
- yt-dlp に `--ffmpeg-location <ffmpeg のディレクトリ>` を渡す。
- 同梱バージョンを README に記録し、再現性を持たせる。

### 16.3 エンジン自己更新の注意（重要）

- `yt-dlp -U` は **自分自身の exe をその場で書き換える**。`Program Files` 配下にインストールされていると権限不足で失敗しうる。
- 対策：更新版を `userData` 配下にダウンロードして配置し、起動時にそちらを優先する方式を推奨。`paths.ts` は「userData の更新版 > 同梱版」の順で解決する。
- 更新ボタンは任意機能だが、サイト仕様変更への追従に有用。

---

## 17. ディレクトリ構成（推奨）

```
media-downloader/
├─ package.json
├─ electron.vite.config.ts
├─ electron-builder.json
├─ tsconfig.json
├─ src/
│  ├─ shared/
│  │  ├─ types.ts          # ドメイン型・エラー型（唯一の真実）
│  │  └─ ipc.ts            # IPC チャンネル名とペイロード型
│  ├─ main/
│  │  ├─ index.ts          # アプリ起動・ウィンドウ生成（セキュア設定）
│  │  ├─ ipcHandlers.ts    # IPC 受け口（zod 検証）
│  │  ├─ JobQueue.ts       # 状態機械・キャンセル
│  │  ├─ paths.ts          # バイナリのパス解決（userData 優先）
│  │  ├─ settings.ts       # electron-store + zod
│  │  └─ logger.ts
│  ├─ engine/              # ★ 共通化の核（main から利用）
│  │  ├─ MediaEngine.ts    # インターフェース
│  │  ├─ YtDlpEngine.ts    # 実装
│  │  ├─ buildArgs.ts      # 純粋関数
│  │  ├─ runProcess.ts     # execa + ツリー kill
│  │  ├─ parseProgress.ts  # 純粋関数
│  │  ├─ classifyError.ts  # 純粋関数
│  │  └─ parseMediaInfo.ts # 純粋関数 + zod
│  ├─ preload/
│  │  └─ preload.ts        # contextBridge で window.api 公開
│  └─ renderer/
│     ├─ App.tsx
│     ├─ components/
│     └─ index.tsx
├─ resources/
│  └─ bin/                 # yt-dlp.exe / ffmpeg.exe / ffprobe.exe
├─ test/
│  ├─ fixtures/            # 各サービスの dump-json / stderr サンプル
│  └─ *.test.ts
└─ build/
   └─ icon.ico
```

---

## 18. 実装ステップ（縦切り・推奨順）

各ステップで「動くもの」を残す。早い段階で実ダウンロードを通し、そこから機能を積む。

1. electron-vite で雛形作成。セキュア設定（`contextIsolation`/`sandbox`）で空ウィンドウを表示。
2. `shared/types.ts`・`shared/ipc.ts` を先に定義（契約ファースト）。preload で型付き `window.api` の骨格を公開。
3. `paths.ts` を実装し、`resources/bin` の `yt-dlp.exe` を解決して `yt-dlp --version` を実行できることを確認。
4. **最小の縦切り**：`buildArgs`（`audio_lossless` のみ）→ `runYtDlp` → 1 件保存を成功させる。
5. `parseProgress` ＋ `--progress-template` を実装し、進捗バーに反映。`postprocessing` 表示を入れる。
6. キャンセル（`AbortController` → ツリー kill）と中間ファイル後始末。
7. 種別切り替え（動画 / mp3 / 無劣化）と保存先選択を実装。
8. `parseMediaInfo`（`--dump-single-json` + zod）と品質選択 UI、**capability ベースのUI適応**（SoundCloud で動画モード無効化）を実装。
9. `classifyError` とエラー表示（userMessage ＋「詳細」）を整備。3.2 のテスト対象サービスで実機確認。
10. 免責モーダル（11.2）。
11. ユニットテスト（15 章）を fixture とともに整備。
12. electron-builder で Windows パッケージング。
13.（任意）キュー・メタデータ埋め込み・字幕・Cookie 連携・エンジン更新ボタン。

---

## 19. Definition of Done（受け入れ基準）

- [ ] 3.2 の全サービスで「probe → 種別選択 → ダウンロード成功」を実機確認した（**SoundCloud 必須**）。
- [ ] SoundCloud（音声のみ）で動画モードが自動無効化され、無劣化/mp3 が成功する。
- [ ] ニコニコ動画で日本語タイトルのファイルが文字化けせず保存される（`--restrict-filenames` 不使用）。
- [ ] 進捗バーが %・速度・ETA を表示し、変換中（postprocessing）が区別表示される。
- [ ] ダウンロード中にキャンセルでき、yt-dlp/ffmpeg のプロセスが残らない（孤児なし）。
- [ ] 代表的な失敗（非対応 URL・非公開・年齢制限・ネットワーク断）が適切な日本語メッセージに分類され、「詳細」で生ログを確認できる。
- [ ] 初回起動で免責モーダルが出て、同意するまで利用できない。
- [ ] 子プロセスがすべて配列引数で起動され、URL を文字列補間していない（コードレビューで確認）。
- [ ] `buildArgs` / `parseProgress` / `classifyError` / `parseMediaInfo` にユニットテストがあり、緑。
- [ ] electron-builder で `.exe` が生成され、別マシンで起動・ダウンロードできる。

---

## 20. 既知の制約・注意点

- yt-dlp は頻繁に更新される。サイト仕様変更で動かなくなることがあるため、更新手段（同梱 exe 差し替え or `-U`、16.3）を用意すると安定する。
- 配信プラットフォームの利用規約は技術的可否とは別に存在する。アプリ仕様としては免責（11.2）で対応する。
- DRM 保護ストリーミングは対象外。yt-dlp も基本的に取得しない。
- 署名なし配布では SmartScreen 警告が出る。社内配布等であれば許容範囲。

---

## 付録 A: 最小コマンド早見表（検証用の起点）

| 目的 | コマンド |
|---|---|
| 構造化情報取得（推奨） | `yt-dlp --dump-single-json --no-warnings <URL>` |
| 一覧高速取得（プレイリスト） | `yt-dlp --flat-playlist --dump-single-json <URL>` |
| 動画 最高画質(mp4) | `yt-dlp -f "bv*+ba/b" --merge-output-format mp4 -o "%(title)s [%(id)s].%(ext)s" <URL>` |
| 音声 mp3 最高音質 | `yt-dlp -x --audio-format mp3 --audio-quality 0 -o "%(title)s.%(ext)s" <URL>` |
| 音声 無劣化 | `yt-dlp -f "ba/b" -o "%(title)s.%(ext)s" <URL>` |
| 機械可読な進捗 | `yt-dlp --newline --progress-template "download:[PROG]|%(progress.status)s|%(progress.downloaded_bytes)s|..." <URL>` |
| Windows 安全ファイル名 | `--windows-filenames`（`--restrict-filenames` は使わない） |
| Cookie 連携（任意） | `yt-dlp --cookies-from-browser chrome <URL>` |
| エンジン更新 | `yt-dlp -U`（16.3 の注意あり） |

## 付録 B: 純粋関数の入出力まとめ（テストの的）

| 関数 | 入力 | 出力 | 副作用 |
|---|---|---|---|
| `buildDownloadArgs` | `DownloadRequest`, `BinPaths` | `string[]`（引数配列） | なし |
| `parseProgressLine` | 1行, `jobId` | `DownloadProgress \| null` | なし |
| `classifyError` | stderr 文字列 | `AppError` | なし |
| `parseMediaInfo` | yt-dlp JSON | `MediaInfo` | なし（zod 検証のみ） |

> これら4つが純粋に保たれている限り、エンジンの挙動はテストで固定できる。I/O（spawn・ファイル・IPC）はこの外側に置くこと。