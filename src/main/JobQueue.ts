import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { MediaEngine } from '../engine/MediaEngine'
import { EngineError } from '../engine/YtDlpEngine'
import { classifyError } from '../engine/classifyError'
import type {
  AppleMusicOutcome,
  BinPaths,
  DownloadProgress,
  DownloadRequest,
  JobDonePayload,
  JobStatus
} from '../shared/types'
import { addToAppleMusic } from './appleMusic'
import { applyMetadata, hasMetadataOverride } from '../engine/applyMetadata'
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
    private readonly binPaths: BinPaths,
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
    // ジョブ専用の一時フォルダ。断片・中間ファイルはすべてここに隔離し、
    // 最終ファイルのみ outputDir に置く。完了/失敗/中断のいずれでも丸ごと削除する。
    // outputDir 直下に置くのは home と同一ファイルシステムにして最終 move を rename で
    // 済ませる（大容量ファイルのコピーを避ける）ため。
    const tempDir = join(req.outputDir, `.mdl-tmp-${id}`)
    try {
      await mkdir(tempDir, { recursive: true })
      this.emit(id, 'analyzing')
      const result = await this.engine.download(req, {
        signal: controller.signal,
        tempDir,
        onProgress: (p) => {
          job.status = p.status
          this.events.onProgress({ ...p, jobId: id })
        }
      })
      // メタデータ上書き（DL後に ffmpeg で埋め込みタグへ反映。ベストエフォート）。
      // Apple Music コピーより前に行い、コピーされるファイルもタグ済みにする。
      if (result.outputPath && hasMetadataOverride(req.metadata)) {
        try {
          await applyMetadata(this.binPaths.ffmpegDir, result.outputPath, req.metadata!)
        } catch (e) {
          logger.error('applyMetadata failed', { jobId: id, error: String(e) })
        }
      }

      job.status = 'completed'
      this.emit(id, 'completed')
      // 完了後の Apple Music 追加（ベストエフォート。失敗してもジョブは成功のまま）。
      let appleMusic: AppleMusicOutcome | undefined
      if (req.addToAppleMusic && result.outputPath) {
        appleMusic = await addToAppleMusic(result.outputPath, req.itunesAutoAddDir ?? null)
      }
      this.events.onDone({ jobId: id, ok: true, result: { ...result, jobId: id, appleMusic } })
    } catch (e) {
      if (controller.signal.aborted) {
        job.status = 'cancelled'
        this.events.onDone({ jobId: id, ok: false, error: { code: 'CANCELLED', userMessage: 'ダウンロードを中止しました。', detail: '' } })
        return
      }
      const error = e instanceof EngineError ? e.appError : classifyError(e instanceof Error ? e.message : String(e))
      job.status = 'failed'
      logger.error('job failed', { jobId: id, code: error.code })
      this.events.onDone({ jobId: id, ok: false, error })
    } finally {
      await this.cleanupTemp(tempDir)
    }
  }

  /** ジョブ専用一時フォルダの後始末。bounded・best-effort。 */
  private async cleanupTemp(tempDir: string): Promise<void> {
    try {
      await rm(tempDir, { recursive: true, force: true })
    } catch {
      // 既に無い等は無視
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
