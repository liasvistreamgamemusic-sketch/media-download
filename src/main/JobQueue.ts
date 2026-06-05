import { readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { MediaEngine } from '../engine/MediaEngine'
import { EngineError } from '../engine/YtDlpEngine'
import { classifyError } from '../engine/classifyError'
import type {
  DownloadProgress,
  DownloadRequest,
  JobDonePayload,
  JobStatus
} from '../shared/types'
import { logger } from './logger'

interface Job {
  id: string
  req: DownloadRequest
  controller: AbortController
  status: JobStatus
}

export interface JobQueueEvents {
  onProgress: (p: DownloadProgress) => void
  onDone: (p: JobDonePayload) => void
}

/**
 * ジョブの状態機械とキュー。MVP は同時実行 1（直列）だが、実行ロジックは
 * 件数に依存しない（将来 N 並列に拡張可能）。各ジョブは AbortController を持つ。
 */
export class JobQueue {
  private readonly jobs = new Map<string, Job>()
  private readonly pending: string[] = []
  private running = 0
  private readonly concurrency = 1

  constructor(
    private readonly engine: MediaEngine,
    private readonly events: JobQueueEvents
  ) {}

  enqueue(req: DownloadRequest): string {
    const id = randomUUID()
    this.jobs.set(id, { id, req, controller: new AbortController(), status: 'queued' })
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
      job.status = 'cancelled'
      this.events.onDone({ jobId, ok: false, error: { code: 'CANCELLED', userMessage: 'ダウンロードを中止しました。', detail: '' } })
      this.jobs.delete(jobId)
    }
  }

  /** アプリ終了時：全ジョブを中断 */
  abortAll(): void {
    for (const job of this.jobs.values()) job.controller.abort()
  }

  private pump(): void {
    while (this.running < this.concurrency && this.pending.length > 0) {
      const id = this.pending.shift()!
      const job = this.jobs.get(id)
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
    try {
      this.emit(id, 'analyzing')
      const result = await this.engine.download(req, {
        signal: controller.signal,
        onProgress: (p) => {
          job.status = p.status
          this.events.onProgress({ ...p, jobId: id })
        }
      })
      job.status = 'completed'
      this.emit(id, 'completed')
      this.events.onDone({ jobId: id, ok: true, result: { ...result, jobId: id } })
    } catch (e) {
      if (controller.signal.aborted) {
        job.status = 'cancelled'
        await this.cleanupPartials(req.outputDir)
        this.events.onDone({ jobId: id, ok: false, error: { code: 'CANCELLED', userMessage: 'ダウンロードを中止しました。', detail: '' } })
        return
      }
      const error = e instanceof EngineError ? e.appError : classifyError(e instanceof Error ? e.message : String(e))
      job.status = 'failed'
      logger.error('job failed', { jobId: id, code: error.code })
      await this.cleanupPartials(req.outputDir)
      this.events.onDone({ jobId: id, ok: false, error })
    }
  }

  /** 中間ファイル（.part / .ytdl）の後始末。bounded・best-effort。 */
  private async cleanupPartials(dir: string): Promise<void> {
    try {
      const entries = await readdir(dir)
      await Promise.all(
        entries
          .filter((f) => f.endsWith('.part') || f.endsWith('.ytdl'))
          .map((f) => rm(join(dir, f), { force: true }))
      )
    } catch {
      // ディレクトリが無い等は無視
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
