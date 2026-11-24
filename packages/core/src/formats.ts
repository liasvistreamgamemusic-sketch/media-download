// 出力形式の定義表（唯一の真実）。CLI・ライブラリ・アプリの UI が同じ表を参照する。
// 純粋なデータと関数のみ（renderer からも import できるよう node に依存しない）。
//
// yt-dlp 2026.11.23 の --help で以下を確認済み:
//   --merge-output-format: avi, flv, mkv, mov, mp4, webm（"/" 区切りで候補列挙可）
//   --remux-video / --recode-video: mkv, mov, mp4, webm ほか
// mov は対象外: Opus 等を格納できず、素材によってリマックスが失敗するため（実機で確認）。
//   --audio-format: aac, alac, flac, m4a, mp3, opus, vorbis, wav

export const OUTPUT_FORMATS = [
  'mp4',
  'mkv',
  'webm',
  'best',
  'mp3',
  'm4a',
  'opus',
  'flac',
  'wav',
  'alac',
  'audio'
] as const

export type OutputFormat = (typeof OUTPUT_FORMATS)[number]

export const DEFAULT_FORMAT: OutputFormat = 'mp4'

export interface FormatSpec {
  kind: 'video' | 'audio'
  label: string
  /** --embed-thumbnail に対応するコンテナか（非対応で指定すると yt-dlp の後処理が失敗する） */
  thumbnail: boolean
  /** -f の既定フォーマット選択式 */
  selector: string
  /** 選択式の後に付ける yt-dlp 引数 */
  args: readonly string[]
}

const VIDEO_SELECTOR = 'bv*+ba/b'
// -x は後処理であってフォーマット選択を変えない。-f を音声のみに固定しないと
// 映像も取得してしまい、YouTube の SABR/403 で映像だけ失敗する原因になる。
const AUDIO_SELECTOR = 'ba/b'
// 非可逆形式へ変換するときの VBR 品質（0 = 最高）
const LOSSY_AUDIO_QUALITY = ['--audio-quality', '0'] as const

/** 指定コンテナへ結合し、単一ファイルで落ちてきた場合もリマックスで揃える。 */
function container(fmt: 'mp4' | 'mkv'): readonly string[] {
  return ['--merge-output-format', fmt, '--remux-video', fmt]
}

export const FORMAT_SPECS: Record<OutputFormat, FormatSpec> = {
  mp4: { kind: 'video', label: '動画 mp4（最高画質）', thumbnail: true, selector: VIDEO_SELECTOR, args: container('mp4') },
  mkv: { kind: 'video', label: '動画 mkv（最高画質）', thumbnail: true, selector: VIDEO_SELECTOR, args: container('mkv') },
  webm: {
    kind: 'video',
    label: '動画 webm',
    thumbnail: false,
    // webm 同士を優先して結合。合わなければ mkv に結合してから webm へ再エンコードする。
    selector: 'bv*[ext=webm]+ba[ext=webm]/b[ext=webm]/bv*+ba/b',
    args: ['--merge-output-format', 'webm/mkv', '--recode-video', 'webm']
  },
  best: {
    kind: 'video',
    label: '動画（元の形式のまま）',
    thumbnail: false, // 出力コンテナが事前に決まらないため埋め込まない
    selector: VIDEO_SELECTOR,
    args: []
  },
  mp3: { kind: 'audio', label: '音声 mp3', thumbnail: true, selector: AUDIO_SELECTOR, args: ['-x', '--audio-format', 'mp3', ...LOSSY_AUDIO_QUALITY] },
  m4a: { kind: 'audio', label: '音声 m4a（AAC）', thumbnail: true, selector: AUDIO_SELECTOR, args: ['-x', '--audio-format', 'm4a', ...LOSSY_AUDIO_QUALITY] },
  opus: { kind: 'audio', label: '音声 opus', thumbnail: true, selector: AUDIO_SELECTOR, args: ['-x', '--audio-format', 'opus', ...LOSSY_AUDIO_QUALITY] },
  flac: { kind: 'audio', label: '音声 flac（可逆）', thumbnail: true, selector: AUDIO_SELECTOR, args: ['-x', '--audio-format', 'flac'] },
  wav: { kind: 'audio', label: '音声 wav（非圧縮）', thumbnail: false, selector: AUDIO_SELECTOR, args: ['-x', '--audio-format', 'wav'] },
  alac: {
    kind: 'audio',
    label: '音声 ALAC（Apple ロスレス .m4a）',
    thumbnail: true,
    selector: AUDIO_SELECTOR,
    // yt-dlp 2026.11.23 の不具合回避: ExtractAudio が ALAC 用の "-acodec alac" を品質引数で
    // 上書きして捨てるため、そのままだと ffmpeg 既定の AAC（非可逆）で .m4a が作られる。
    // エンコーダを後処理引数で明示する（実機で codec=alac になることを確認済み）。
    args: ['-x', '--audio-format', 'alac', '--postprocessor-args', 'ExtractAudio:-c:a alac']
  },
  audio: {
    kind: 'audio',
    label: '音声（元のコーデックのまま・無劣化）',
    thumbnail: true,
    selector: AUDIO_SELECTOR,
    // --audio-format なしの -x は再エンコードせず音声コンテナへリマックスする
    // （webm→opus, m4a→m4a）。.webm のままだとサムネ埋め込みに失敗するため -x は必須。
    args: ['-x']
  }
}

export function isOutputFormat(v: string): v is OutputFormat {
  return (OUTPUT_FORMATS as readonly string[]).includes(v)
}

export function isVideoFormat(f: OutputFormat): boolean {
  return FORMAT_SPECS[f].kind === 'video'
}
