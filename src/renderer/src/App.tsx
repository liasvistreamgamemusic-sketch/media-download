import { useEffect, useState } from 'react'
import {
  CircleCheck,
  Download,
  Film,
  FolderOpen,
  FolderOutput,
  LoaderCircle,
  Pencil,
  Search,
  Trash2,
  TriangleAlert,
  X
} from 'lucide-react'
import { DisclaimerModal } from './components/DisclaimerModal'
import { formatBytes, formatDuration, formatSpeed } from './format'
import type {
  AppError,
  DownloadKind,
  DownloadProgress,
  FormatOption,
  MediaInfo,
  MetadataOverride,
  Settings
} from '@shared/types'

const KIND_LABEL: Record<DownloadKind, string> = {
  video_best: '動画（最高画質 mp4）',
  audio_mp3: '音声 mp3（最高音質）',
  audio_lossless: '音声 無劣化（元コーデック）'
}

interface MetaFields {
  title: string
  artist: string
  album: string
  comment: string
}

/** 解析済みの1件（= 1動画）。メタデータは編集可能でDL時に上書き反映される。 */
interface Item {
  key: string
  url: string
  info: MediaInfo
  formatId: string // '' = おまかせ最高
  meta: MetaFields
  prefill: MetaFields // 変更検知用（編集されたフィールドだけ上書きを送る）
  editing: boolean
}

/** 投入後のダウンロードジョブの進捗・結果。 */
interface Task {
  jobId: string
  title: string
  progress: DownloadProgress | null
  done: boolean
  error: AppError | null
  cancelled: boolean
  appleMusicMsg: string | null
}

function formatLabel(f: FormatOption): string {
  const bits = [
    f.resolution ?? (f.isAudio && !f.isVideo ? '音声' : ''),
    f.fps ? `${f.fps}fps` : '',
    f.ext,
    f.abr ? `${Math.round(f.abr)}kbps` : '',
    f.filesize ? formatBytes(f.filesize) : '',
    f.note ?? ''
  ].filter(Boolean)
  return `${f.formatId} · ${bits.join(' · ')}`
}

// セッション内で一意なローカルキー。crypto.randomUUID は file:// で未定義になりうるため使わない。
let keySeq = 0
const nextKey = (): string => `item-${++keySeq}`

function prefillFrom(info: MediaInfo): MetaFields {
  return {
    title: info.title ?? '',
    artist: info.artist ?? info.uploader ?? '',
    album: info.album ?? '',
    comment: info.description ?? ''
  }
}

export default function App(): React.JSX.Element {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [showDisclaimer, setShowDisclaimer] = useState(false)
  const [reshow, setReshow] = useState(false)
  const [engineVer, setEngineVer] = useState('…')

  const [urlsText, setUrlsText] = useState('')
  const [probing, setProbing] = useState(false)
  const [items, setItems] = useState<Item[]>([])
  const [probeErrors, setProbeErrors] = useState<{ url: string; error: AppError }[]>([])

  const [kind, setKind] = useState<DownloadKind>('video_best')
  const [outputDir, setOutputDir] = useState('')
  const [addToAppleMusic, setAddToAppleMusic] = useState(false)
  const [itunesDir, setItunesDir] = useState<string | null>(null)

  const [tasks, setTasks] = useState<Task[]>([])
  const [actionError, setActionError] = useState<AppError | null>(null)
  const [showDetail, setShowDetail] = useState(false)

  const anyActive = tasks.some((t) => !t.done && !t.error && !t.cancelled)
  const anyFinished = tasks.some((t) => t.done || t.error || t.cancelled)

  // 初期化
  useEffect(() => {
    void window.api.getSettings().then((s) => {
      setSettings(s)
      setOutputDir(s.outputDir)
      setKind(s.defaultKind)
      setAddToAppleMusic(s.addToAppleMusic)
      setItunesDir(s.itunesAutoAddDir)
      if (!s.disclaimerAccepted) setShowDisclaimer(true)
    })
    void window.api.engineVersion().then(setEngineVer)

    const offProg = window.api.onProgress((p) => {
      setTasks((prev) => prev.map((t) => (t.jobId === p.jobId ? { ...t, progress: p } : t)))
    })
    const offDone = window.api.onJobDone((d) => {
      setTasks((prev) =>
        prev.map((t) => {
          if (t.jobId !== d.jobId) return t
          if (d.ok) {
            return {
              ...t,
              done: true,
              progress: null,
              error: null,
              appleMusicMsg: d.result.appleMusic?.message ?? null
            }
          }
          if (d.error.code === 'CANCELLED') return { ...t, progress: null, cancelled: true }
          return { ...t, progress: null, error: d.error }
        })
      )
    })
    const offDisc = window.api.onShowDisclaimer(() => {
      setReshow(true)
      setShowDisclaimer(true)
    })
    return () => {
      offProg()
      offDone()
      offDisc()
    }
  }, [])

  // 共有種別から item の実効種別を導出（音声のみソースでは動画→無劣化に読み替え）。
  function effectiveKindFor(info: MediaInfo): DownloadKind {
    return !info.hasVideo && kind === 'video_best' ? 'audio_lossless' : kind
  }

  function patchItem(key: string, patch: Partial<Item>): void {
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...patch } : it)))
  }

  function patchMeta(key: string, patch: Partial<MetaFields>): void {
    setItems((prev) =>
      prev.map((it) => (it.key === key ? { ...it, meta: { ...it.meta, ...patch } } : it))
    )
  }

  function changeKind(k: DownloadKind): void {
    setKind(k)
    // 種別が変わると品質候補も変わるため formatId をリセット（おまかせ最高に戻す）。
    setItems((prev) => prev.map((it) => ({ ...it, formatId: '' })))
  }

  async function onProbe(): Promise<void> {
    const lines = Array.from(
      new Set(
        urlsText
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean)
      )
    )
    const existing = new Set(items.map((i) => i.url))
    const targets = lines.filter((u) => !existing.has(u))
    if (!targets.length) return
    setProbing(true)
    setProbeErrors([])
    setActionError(null)
    const errs: { url: string; error: AppError }[] = []
    for (const url of targets) {
      try {
        const info = await window.api.probe(url)
        const prefill = prefillFrom(info)
        setItems((prev) => [
          ...prev,
          {
            key: nextKey(),
            url: info.webpageUrl || url,
            info,
            formatId: '',
            meta: { ...prefill },
            prefill,
            editing: false
          }
        ])
      } catch (e) {
        errs.push({ url, error: toAppError(e) })
      }
    }
    setProbeErrors(errs)
    setUrlsText('')
    setProbing(false)
  }

  async function onDownloadAll(): Promise<void> {
    if (!items.length || !outputDir) return
    setActionError(null)
    const newTasks: Task[] = []
    for (const it of items) {
      const eff = effectiveKindFor(it.info)
      const dirty =
        it.meta.title !== it.prefill.title ||
        it.meta.artist !== it.prefill.artist ||
        it.meta.album !== it.prefill.album ||
        it.meta.comment !== it.prefill.comment
      const metadata: MetadataOverride | undefined = dirty ? it.meta : undefined
      try {
        const id = await window.api.startDownload({
          url: it.url,
          kind: eff,
          formatId: it.formatId || undefined,
          outputDir,
          embedMetadata: settings?.embedMetadata,
          embedThumbnail: settings?.embedThumbnail,
          noPlaylist: true,
          cookiesFromBrowser: settings?.cookiesFromBrowser ?? undefined,
          addToAppleMusic,
          itunesAutoAddDir: itunesDir ?? undefined,
          metadata
        })
        newTasks.push({
          jobId: id,
          title: it.meta.title || it.info.title,
          progress: null,
          done: false,
          error: null,
          cancelled: false,
          appleMusicMsg: null
        })
      } catch (e) {
        setActionError(toAppError(e))
      }
    }
    setTasks((prev) => [...prev, ...newTasks])
    setItems([])
  }

  async function onCancelTask(jobId: string): Promise<void> {
    try {
      await window.api.cancelDownload(jobId)
    } catch {
      /* done イベントで状態は更新される */
    }
  }

  function clearFinished(): void {
    setTasks((prev) => prev.filter((t) => !t.done && !t.error && !t.cancelled))
  }

  function onToggleAppleMusic(checked: boolean): void {
    setAddToAppleMusic(checked)
    void window.api.setSettings({ addToAppleMusic: checked })
  }

  async function onPickItunesDir(): Promise<void> {
    try {
      const dir = await window.api.pickFolder()
      if (dir) {
        setItunesDir(dir)
        void window.api.setSettings({ itunesAutoAddDir: dir })
      }
    } catch (e) {
      setActionError(toAppError(e))
    }
  }

  async function onOpenItunesDir(): Promise<void> {
    const dir = await window.api.resolveItunesDir(itunesDir ?? null)
    if (dir) await window.api.openFolder(dir)
    else
      setActionError({
        code: 'UNKNOWN',
        userMessage:
          'iTunes の自動追加フォルダが見つかりませんでした。「フォルダを指定」から選んでください。',
        detail: ''
      })
  }

  async function onPickFolder(): Promise<void> {
    try {
      const dir = await window.api.pickFolder()
      if (dir) {
        setOutputDir(dir)
        void window.api.setSettings({ outputDir: dir })
      }
    } catch (e) {
      setActionError(toAppError(e))
    }
  }

  async function acceptDisclaimer(): Promise<void> {
    try {
      await window.api.setSettings({ disclaimerAccepted: true })
      setSettings((s) => (s ? { ...s, disclaimerAccepted: true } : s))
    } finally {
      setShowDisclaimer(false)
    }
  }

  return (
    <div className="app">
      <header>
        <h1>
          <Film size={22} className="logo" />
          Media Downloader
        </h1>
        <span className="engine">yt-dlp {engineVer}</span>
      </header>

      <section className="row url-input">
        <textarea
          className="url multi"
          placeholder="URL を貼り付け（複数の場合は1行に1つ）"
          value={urlsText}
          onChange={(e) => setUrlsText(e.target.value)}
          rows={3}
          disabled={probing}
        />
        <button className="primary" onClick={onProbe} disabled={!urlsText.trim() || probing}>
          {probing ? <LoaderCircle size={16} className="spin" /> : <Search size={16} />}
          {probing ? '解析中…' : '解析して追加'}
        </button>
      </section>

      {probeErrors.length > 0 && (
        <section className="error">
          <div className="error-msg">
            <TriangleAlert size={18} />
            <span>{probeErrors.length}件のURLを解析できませんでした。</span>
          </div>
          <ul className="probe-errors">
            {probeErrors.map((e, i) => (
              <li key={i}>
                <span className="bad-url">{e.url}</span> — {e.error.userMessage}
              </li>
            ))}
          </ul>
        </section>
      )}

      {items.length > 0 && (
        <>
          <fieldset className="kinds">
            <legend>種別（全件に適用）</legend>
            {(Object.keys(KIND_LABEL) as DownloadKind[]).map((k) => (
              <label key={k}>
                <input
                  type="radio"
                  name="kind"
                  checked={kind === k}
                  onChange={() => changeKind(k)}
                />
                {KIND_LABEL[k]}
              </label>
            ))}
          </fieldset>

          <section className="items">
            {items.map((it) => (
              <ItemCard
                key={it.key}
                item={it}
                effectiveKind={effectiveKindFor(it.info)}
                onChange={(patch) => patchItem(it.key, patch)}
                onMeta={(patch) => patchMeta(it.key, patch)}
                onRemove={() => setItems((prev) => prev.filter((x) => x.key !== it.key))}
              />
            ))}
          </section>
        </>
      )}

      <section className="row">
        <label className="field grow">
          保存先
          <input value={outputDir} readOnly />
        </label>
        <button onClick={onPickFolder}>
          <FolderOutput size={16} />
          変更
        </button>
      </section>

      <section className="applemusic">
        <label className="checkbox">
          <input
            type="checkbox"
            checked={addToAppleMusic}
            onChange={(e) => onToggleAppleMusic(e.target.checked)}
          />
          ダウンロード後に Apple Music へ追加（iTunes 経由・iCloudで iPhone に同期）
        </label>
        {addToAppleMusic && (
          <div className="subhint">
            <span>
              {itunesDir
                ? `追加先: ${itunesDir}`
                : '※ クラシック iTunes が必要です。自動検出できない場合は指定してください。'}
            </span>
            <span className="subhint-actions">
              <button className="link" onClick={onOpenItunesDir}>
                追加フォルダを開く
              </button>
              <button className="link" onClick={onPickItunesDir}>
                {itunesDir ? 'フォルダを変更' : 'フォルダを指定'}
              </button>
            </span>
          </div>
        )}
      </section>

      <section className="actions">
        <button className="primary big" onClick={onDownloadAll} disabled={!items.length || !outputDir}>
          <Download size={18} />
          {items.length > 1 ? `すべてダウンロード（${items.length}件）` : 'ダウンロード'}
        </button>
      </section>

      {tasks.length > 0 && (
        <section className="tasks">
          <div className="tasks-head">
            <span>ダウンロード{anyActive ? '中…' : ''}</span>
            <span className="tasks-actions">
              <button className="link" onClick={() => window.api.openFolder(outputDir)}>
                <FolderOpen size={14} />
                保存先を開く
              </button>
              {anyFinished && (
                <button className="link" onClick={clearFinished}>
                  完了分をクリア
                </button>
              )}
            </span>
          </div>
          {tasks.map((t) => (
            <TaskRow key={t.jobId} task={t} onCancel={() => onCancelTask(t.jobId)} />
          ))}
        </section>
      )}

      {actionError && (
        <ErrorBox error={actionError} show={showDetail} onToggle={() => setShowDetail((v) => !v)} />
      )}

      {showDisclaimer && (
        <DisclaimerModal
          onAccept={acceptDisclaimer}
          onClose={reshow ? () => setShowDisclaimer(false) : undefined}
        />
      )}
    </div>
  )
}

function ItemCard({
  item,
  effectiveKind,
  onChange,
  onMeta,
  onRemove
}: {
  item: Item
  effectiveKind: DownloadKind
  onChange: (patch: Partial<Item>) => void
  onMeta: (patch: Partial<MetaFields>) => void
  onRemove: () => void
}): React.JSX.Element {
  const { info, meta } = item
  const choices =
    effectiveKind === 'video_best'
      ? info.formats.filter((f) => f.isVideo)
      : info.formats.filter((f) => f.isAudio)

  return (
    <div className="item">
      <div className="item-head">
        {info.thumbnailUrl && <img src={info.thumbnailUrl} alt="" className="thumb" />}
        <div className="item-main">
          <div className="title">{meta.title || info.title}</div>
          <div className="meta">
            {info.uploader ?? info.extractor}
            {info.durationSec != null && ` · ${formatDuration(info.durationSec)}`}
            {!info.hasVideo && ' · 音声のみ'}
          </div>
        </div>
        <div className="item-buttons">
          <button
            className={`icon ${item.editing ? 'active' : ''}`}
            title="メタデータを編集"
            onClick={() => onChange({ editing: !item.editing })}
          >
            <Pencil size={16} />
          </button>
          <button className="icon" title="削除" onClick={onRemove}>
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      {item.editing && (
        <div className="meta-editor">
          <label className="field">
            タイトル
            <input value={meta.title} onChange={(e) => onMeta({ title: e.target.value })} />
          </label>
          <div className="row">
            <label className="field grow">
              アーティスト
              <input value={meta.artist} onChange={(e) => onMeta({ artist: e.target.value })} />
            </label>
            <label className="field grow">
              アルバム
              <input value={meta.album} onChange={(e) => onMeta({ album: e.target.value })} />
            </label>
          </div>
          <label className="field">
            説明
            <textarea
              rows={2}
              value={meta.comment}
              onChange={(e) => onMeta({ comment: e.target.value })}
            />
          </label>
        </div>
      )}

      <label className="field item-quality">
        品質
        <select value={item.formatId} onChange={(e) => onChange({ formatId: e.target.value })}>
          <option value="">おまかせ最高</option>
          {choices.map((f) => (
            <option key={f.formatId} value={f.formatId}>
              {formatLabel(f)}
            </option>
          ))}
        </select>
      </label>
    </div>
  )
}

function TaskRow({ task, onCancel }: { task: Task; onCancel: () => void }): React.JSX.Element {
  const p = task.progress
  const isPost = p?.status === 'postprocessing'
  const active = !task.done && !task.error && !task.cancelled
  const statusText = task.done
    ? '完了'
    : task.cancelled
      ? '中止しました'
      : task.error
        ? 'エラー'
        : !p
          ? '待機中…'
          : p.status === 'analyzing'
            ? '解析中…'
            : p.status === 'queued'
              ? '待機中…'
              : isPost
                ? '変換中…'
                : 'ダウンロード中'

  return (
    <div className="task">
      <div className="task-top">
        <span className="task-title">
          {task.done && <CircleCheck size={15} className="ok-icon" />}
          {task.error && <TriangleAlert size={15} className="err-icon" />}
          {task.title}
        </span>
        {active && (
          <button className="link danger-link" onClick={onCancel}>
            <X size={14} />
            中止
          </button>
        )}
      </div>
      <div className="bar">
        <div
          className={`fill ${isPost ? 'post' : ''} ${task.done ? 'complete' : ''}`}
          style={{ width: `${task.done ? 100 : (p?.percent ?? (isPost ? 100 : 0))}%` }}
        />
      </div>
      <div className="progress-meta">
        <span>{statusText}</span>
        <span>
          {p?.percent != null && `${p.percent.toFixed(1)}%`}
          {p?.speedBps != null && ` · ${formatSpeed(p.speedBps)}`}
          {p?.etaSec != null && ` · 残り ${formatDuration(p.etaSec)}`}
        </span>
      </div>
      {task.error && <p className="task-error">{task.error.userMessage}</p>}
      {task.appleMusicMsg && <p className="applemusic-result">{task.appleMusicMsg}</p>}
    </div>
  )
}

function ErrorBox({
  error,
  show,
  onToggle
}: {
  error: AppError
  show: boolean
  onToggle: () => void
}): React.JSX.Element {
  return (
    <section className="error">
      <div className="error-msg">
        <TriangleAlert size={18} />
        <span>{error.userMessage}</span>
      </div>
      {error.detail && (
        <>
          <button className="link" onClick={onToggle}>
            {show ? '詳細を隠す' : '詳細'}
          </button>
          {show && <pre className="detail">{error.detail}</pre>}
        </>
      )}
    </section>
  )
}

function toAppError(e: unknown): AppError {
  const msg = e instanceof Error ? e.message : String(e)
  return { code: 'UNKNOWN', userMessage: msg || '不明なエラーが発生しました。', detail: msg }
}
