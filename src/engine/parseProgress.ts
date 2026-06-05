import type { DownloadProgress, JobStatus } from '../shared/types'

/**
 * PROGRESS_TEMPLATE が出す `[PROG]|...` 行のみを解釈する純粋関数。
 * NA / 空文字は null に正規化する。それ以外の行は null を返す。
 */
export function parseProgressLine(line: string, jobId: string): DownloadProgress | null {
  if (!line.startsWith('[PROG]|')) return null

  const parts = line.split('|')
  // [PROG] | status | downloaded | total | estimate | speed | eta
  const [, status, dl, total, est, speed, eta] = parts

  const num = (v: string | undefined): number | null =>
    v === undefined || v === 'NA' || v === '' ? null : Number.isNaN(Number(v)) ? null : Number(v)

  const downloadedBytes = num(dl)
  const totalBytes = num(total) ?? num(est) // total が NA なら推定値
  const percent =
    downloadedBytes != null && totalBytes != null && totalBytes > 0
      ? Math.min(100, (downloadedBytes / totalBytes) * 100)
      : null

  const jobStatus: JobStatus =
    status === 'finished' ? 'postprocessing' : status === 'error' ? 'failed' : 'downloading'

  return {
    jobId,
    status: jobStatus,
    percent,
    downloadedBytes,
    totalBytes,
    speedBps: num(speed),
    etaSec: num(eta)
  }
}

/**
 * フォールバック：progress-template が機能しない環境向けに `[download] 62.0%` だけ拾う。
 * 主経路は parseProgressLine。
 */
const DL_PERCENT = /\[download\]\s+(\d+(?:\.\d+)?)%/

export function parseDownloadPercent(line: string, jobId: string): DownloadProgress | null {
  const m = DL_PERCENT.exec(line)
  if (!m) return null
  return {
    jobId,
    status: 'downloading',
    percent: Math.min(100, Number(m[1])),
    downloadedBytes: null,
    totalBytes: null,
    speedBps: null,
    etaSec: null
  }
}
