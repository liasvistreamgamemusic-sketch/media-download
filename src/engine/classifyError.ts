import type { AppError, AppErrorCode } from '../shared/types'

// stderr → AppErrorCode のヒューリスティック分類。正規表現は yt-dlp の文言変更で
// 陳腐化しうるため、未一致は UNKNOWN とし必ず生ログを保持する（plan.md 6.6 / 12章）。
const RULES: Array<{ test: RegExp; code: AppErrorCode; msg: string }> = [
  {
    test: /Unsupported URL|is not a valid URL/i,
    code: 'UNSUPPORTED_URL',
    msg: 'この URL には対応していません。'
  },
  {
    // ffmpeg より先に判定（"ffmpeg not found" を誤分類しないよう "not found" は 404 文脈に限定）
    test: /ffmpeg.*not.*found|ffprobe.*not.*found|ffmpeg is not installed/i,
    code: 'FFMPEG_MISSING',
    msg: '変換用コンポーネント(ffmpeg)が見つかりません。'
  },
  {
    test: /Video unavailable|is (private|unavailable)|This video is not available|HTTP Error 404|404:? Not Found/i,
    code: 'UNAVAILABLE',
    msg: 'コンテンツが見つからないか、非公開です。'
  },
  {
    test: /available in your country|geo.?restrict|blocked.*in your country|not available in your location/i,
    code: 'GEO_BLOCKED',
    msg: 'お住まいの地域では取得できないコンテンツです。'
  },
  {
    test: /confirm your age|age.?restrict|Sign in to confirm your age/i,
    code: 'AGE_RESTRICTED',
    msg: '年齢制限コンテンツです。ブラウザのログイン情報(Cookie)が必要な場合があります。'
  },
  {
    test: /login required|requires authentication|Sign in to|HTTP Error 40[13]|members.?only/i,
    code: 'AUTH_REQUIRED',
    msg: 'ログインが必要なコンテンツです。'
  },
  {
    test: /getaddrinfo|timed out|Connection.*(refused|reset)|Unable to download.*(webpage|API)|Temporary failure in name resolution|HTTP Error 5\d\d/i,
    code: 'NETWORK',
    msg: 'ネットワークに接続できません。時間をおいて再度お試しください。'
  },
  {
    test: /No space left|not enough space|insufficient.*space/i,
    code: 'DISK',
    msg: '保存先の空き容量が不足しています。'
  },
  {
    test: /Please update|out.?of.?date|nsig extraction failed|Signature extraction failed/i,
    code: 'ENGINE_OUTDATED',
    msg: 'エンジンの更新が必要かもしれません（更新ボタンをお試しください）。'
  }
]

export function classifyError(stderr: string): AppError {
  for (const r of RULES) {
    if (r.test.test(stderr)) {
      return { code: r.code, userMessage: r.msg, detail: stderr }
    }
  }
  return {
    code: 'UNKNOWN',
    userMessage: '不明なエラーが発生しました。詳細をご確認ください。',
    detail: stderr
  }
}
