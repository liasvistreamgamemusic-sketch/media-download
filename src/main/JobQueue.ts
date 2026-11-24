import { randomUUID } from 'node:crypto'
import { CANCELLED_ERROR, toErrorInfo, type MediaDownloader } from '@liasvistreamgamemusic-sketch/media-dl'
import type {
  AppleMusicOutcome,
  DownloadProgress,
  DownloadRequest,
  JobDonePayload,
  JobStatus
} from '../shared/types'
import { addToAppleMusic } from './appleMusic'
import { logger } from './logger'

interface Job {
  id: string
  req: DownloadRequest
  controller: AbortController
}

export interface JobQueueEvents {
  onProgress: (p: DownloadProgress) => void
  onDone: (p: JobDonePayload) => void
}

/** 同時に走らせるダウンロード数。yt-dlp 自体が -N 4 で並列取得するため直列で十分。 */
const CONCURRENCY = 1

/**
 * ジョブの状態機械とキュー。各ジョブは AbortController を持ち、実処理は core の MediaDownloader に委ねる。
 * ここが担うのは順番待ち・進捗の中継・Apple Music 連携（アプリ固有）だけ。
 */
export class JobQueue {
  private readonly jobs = new Map<string, Job>()
  private readonly pending: string[] = []
  private running = 0

  constructor(
    private readonly downloader: MediaDownloader,
    private readonly events: JobQueueEvents
  ) {}

  enqueue(req: DownloadRequest): string {
    const id = randomUUID()
    this.jobs.set(id, { id, req, controller: new AbortController() })
    this.pending.push(id)
    this.emit(id, 'queued')
    queueMicrotask(() => this.pump())
    return id
  }

  cancel(jobId: string): void {
    const job = this.jobs.get(jobId)
    if (!job) return
    job.controller.abort()
    // まだ実行されていなければキューから除去して即 cancelled
    const idx = this.pending.indexOf(jobId)
    if (idx >= 0) {
      this.pending.splice(idx, 1)
      this.jobs.delete(jobId)
      this.events.onDone({ jobId, ok: false, error: CANCELLED_ERROR })
    }
  }

  /** アプリ終了時：全ジョブを中断 */
  abortAll(): void {
    for (const job of this.jobs.values()) job.controller.abort()
  }

  private pump(): void {
    while (this.running < CONCURRENCY && this.pending.length > 0) {
      const id = this.pending.shift()
      const job = id ? this.jobs.get(id) : undefined
      if (!job) continue
      this.running++
      void this.run(job).finally(() => {
        this.running--
        this.jobs.delete(job.id)
        this.pump()
      })
    }
  }

  private async run(job: Job): Promise<void> {
    const { id, req, controller } = job
    const { addToAppleMusic: toAppleMusic, itunesAutoAddDir, ...spec } = req
    try {
      this.emit(id, 'analyzing')
      const result = await this.downloader.download({
        ...spec,
        // Apple Music は opus 等を取り込めないため、無劣化指定時は ALAC（.m4a）へ変換する
        format: toAppleMusic && spec.format === 'audio' ? 'alac' : spec.format,
        signal: controller.signal,
        onProgress: (p) => this.events.onProgress({ ...p, jobId: id })
      })
      for (const w of result.warnings) logger.warn('download warning', { jobId: id, warning: w })
      this.emit(id, 'completed')

      // 完了後の Apple Music 追加（ベストエフォート。失敗してもジョブは成功のまま）。
      let appleMusic: AppleMusicOutcome | undefined
      if (toAppleMusic) {
        for (const f of result.files) appleMusic = await addToAppleMusic(f, itunesAutoAddDir ?? null)
      }
      this.events.onDone({ jobId: id, ok: true, result: { jobId: id, files: result.files, appleMusic } })
    } catch (e) {
      const error = controller.signal.aborted ? CANCELLED_ERROR : toErrorInfo(e)
      if (error.code !== 'CANCELLED') logger.error('job failed', { jobId: id, code: error.code })
      this.events.onDone({ jobId: id, ok: false, error })
    }
  }

  private emit(jobId: string, status: JobStatus): void {
    this.events.onProgress({
      jobId,
      status,
      percent: status === 'completed' ? 100 : null,
      downloadedBytes: null,
      totalBytes: null,
      speedBps: null,
      etaSec: null
    })
  }
}
