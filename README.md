# Media Downloader

URL を貼り付けるだけで YouTube・SoundCloud・ニコニコ動画・CloudFront 等から高品質なメディアをローカル保存できる **デスクトップアプリ（Windows / macOS）**。ダウンロードは [yt-dlp](https://github.com/yt-dlp/yt-dlp)、結合/変換は [ffmpeg](https://ffmpeg.org/) に委譲し、本体は「UI ＋ エンジンを安全に呼び出すラッパー」に徹している。yt-dlp / ffmpeg / ffprobe は静的ビルドを同梱するため、別途インストールは不要。

設計の詳細は [`plan.md`](./plan.md) を参照。

## ダウンロード（利用者向け）

[Releases](https://github.com/liasvistreamgamemusic-sketch/media-download/releases) から OS に合ったファイルを入手する。

| OS | ファイル | 備考 |
|---|---|---|
| Windows | `media-downloader-<ver>-win-x64.exe`（インストーラ） | 通常はこちら。インストール不要なら `…-portable.exe` |
| macOS (Apple Silicon) | `media-downloader-<ver>-mac-arm64.dmg` | M1 以降 |
| macOS (Intel) | `media-downloader-<ver>-mac-x64.dmg` | Intel Mac |

> **未署名配布の注意**
> - **Windows**: 署名が無いため初回起動で SmartScreen 警告が出る。「詳細情報」→「実行」で起動できる。
> - **macOS**: 「開発元を確認できない」と表示される。アプリを右クリック →「開く」、または `xattr -dr com.apple.quarantine "/Applications/Media Downloader.app"` で解除する。
> 社内/個人配布では許容範囲。広く配布する場合はコードサイニング証明書を検討。

## 技術スタック

electron-vite + Electron 39 + React 19 + TypeScript / `execa`（子プロセス）/ `zod`（境界検証）/ `electron-store`（設定）/ `vitest`（テスト）/ `electron-builder`（配布）。

> バージョンは Vite 7 を基点に内部整合させている（`@vitejs/plugin-react` 5系、execa 9 / electron-store 11 は ESM-only のため CJS main にバンドル）。`@latest` で安易に上げないこと。

## セットアップ

```bash
npm install
npm run fetch-binaries        # resources/bin に yt-dlp / ffmpeg / ffprobe を取得
```

`fetch-binaries` は現在のプラットフォーム向けに以下を `resources/bin` へ配置する:
- **yt-dlp**: GitHub releases から取得（`yt-dlp.exe` / `yt-dlp_macos` / `yt-dlp_linux`）。
- **ffmpeg / ffprobe**: `ffmpeg-static` / `ffprobe-static`（npm の静的ビルド）からコピー。Homebrew 等のシステム ffmpeg には依存しない。

`resources/bin` は `.gitignore` 済み（巨大・プラットフォーム依存のためコミットしない）。CI では各OSランナーがネイティブ arch 分を取得する。

> 補足: `paths.ts` は `resources/bin` の同梱 ffmpeg を最優先で使い、無い場合のみシステムの ffmpeg（PATH / Homebrew）にフォールバックする。`fetch-binaries` を実行していれば常に静的同梱版が使われる。

## 開発

```bash
npm run dev          # electron-vite dev（HMR）
npm run typecheck    # main(node) + renderer(web) を tsc で型チェック
npm test             # 純粋関数のユニットテスト（vitest）
npm run test:coverage
```

## リリース（メンテナ向け）

リリースは **GitHub Actions** で自動化されている（[.github/workflows/release.yml](.github/workflows/release.yml)）。

```bash
# 1. バージョンを更新（package.json の version）してコミット
# 2. タグを打って push するとビルド〜Release 作成まで自動実行
git tag v1.0.0
git push origin v1.0.0
```

タグ push で 3 ジョブ（Windows x64 / macOS arm64 / macOS x64）が起動し、各ランナーが
ネイティブ arch の yt-dlp・ffmpeg・ffprobe を取得 → `electron-builder` でパッケージ →
**GitHub Release（ドラフト）** に成果物をアップロードする。成果物を確認したら Release を
**Publish** する。

### ローカルビルド

```bash
npm run build              # 型チェック + electron-vite build → out/
npm run package:win        # Windows: NSIS インストーラ + portable .exe → release/
npm run package:mac        # macOS: dmg + zip → release/
```

- `electron-builder.yml` の `extraResources` で `resources/bin` を `process.resourcesPath/bin` に同梱する。
- macOS では `npm run package:win` は実質ビルドできない（Windows ランナーが必要）。Windows 版は CI で生成する。

### アイコン

`build/icon.svg` がマスター。`npm run make-icons`（macOS で実行）で `build/icon.png`(1024) /
`icon.icns`(mac) / `icon.ico`(win) を再生成する。生成物はリポジトリにコミット済みのため、
CI では再生成不要。

## アーキテクチャ

```
Renderer (React) ──IPC(型付き)──▶ Main (Node) ──MediaEngine IF──▶ YtDlpEngine ──spawn(配列)──▶ yt-dlp ─▶ ffmpeg
```

- **エンジン層 `src/engine/`** が共通化の核。yt-dlp 呼び出しはここに閉じ込める。純粋関数（`buildArgs` / `parseProgress` / `classifyError` / `parseMediaInfo`）と I/O（`runProcess`）を分離。
- **サイト固有ロジックを持たない**。振る舞いは probe の `hasVideo`/`hasAudio`（capability）から導出する（例：SoundCloud は音声のみ→動画モード自動無効化）。
- **共有型は `src/shared/`** に集約（`types.ts` / `ipc.ts` / `schemas.ts`）。
- **セキュリティ**: `contextIsolation: true` / `nodeIntegration: false` / `sandbox: true`。子プロセスは配列引数のみで起動（`shell` 不使用）。IPC ペイロードは Main 側で zod 再検証。

ディレクトリ構成は `plan.md` 17章に準拠。

## 同梱バージョン（再現性のため記録）

| コンポーネント | 調達元 |
|---|---|
| yt-dlp | GitHub releases の latest（`yt-dlp.exe` / `yt-dlp_macos`） |
| ffmpeg / ffprobe | `ffmpeg-static` 5.x / `ffprobe-static` 3.x（静的ビルド） |

> yt-dlp はサイト仕様変更に追従して頻繁に更新される。動かなくなった場合は `npm run fetch-binaries -- --force` で更新するか、アプリ内のエンジン更新（`yt-dlp -U`）を使う。

## 法的留意事項

本アプリは技術的なダウンロード手段を提供するのみ。各サイトの利用規約・著作権法の遵守責任は利用者にある。初回起動時に免責モーダルへの同意を求める（ヘルプメニューから再表示可能）。詳細は `plan.md` 11.2 を参照。
