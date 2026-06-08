import { useEffect, useMemo, useState } from 'react'
import {
  CircleCheck,
  Download,
  Film,
  FolderOpen,
  FolderOutput,
  LoaderCircle,
  Search,
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
  Settings
} from '@shared/types'

const KIND_LABEL: Record<DownloadKind, string> = {
  video_best: '動画（最高画質 mp4）',
  audio_mp3: '音声 mp3（最高音質）',
  audio_lossless: '音声 無劣化（元コーデック）'
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

export default function App(): React.JSX.Element {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [showDisclaimer, setShowDisclaimer] = useState(false)
  const [reshow, setReshow] = useState(false)
  const [engineVer, setEngineVer] = useState('…')

  const [url, setUrl] = useState('')
  const [probing, setProbing] = useState(false)
  const [info, setInfo] = useState<MediaInfo | null>(null)
  const [probeError, setProbeError] = useState<AppError | null>(null)

  const [kind, setKind] = useState<DownloadKind>('video_best')
  const [formatId, setFormatId] = useState<string>('') // '' = おまかせ最高
  const [outputDir, setOutputDir] = useState('')
  const [noPlaylist, setNoPlaylist] = useState(true)
  const [addToAppleMusic, setAddToAppleMusic] = useState(false)
  const [itunesDir, setItunesDir] = useState<string | null>(null)

  const [jobId, setJobId] = useState<string | null>(null)
  const [progress, setProgress] = useState<DownloadProgress | null>(null)
  const [jobError, setJobError] = useState<AppError | null>(null)
  const [done, setDone] = useState(false)
  const [appleMusicMsg, setAppleMusicMsg] = useState<string | null>(null)
  const [showDetail, setShowDetail] = useState(false)

  const downloading = jobId !== null

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

    const offProg = window.api.onProgress((p) => setProgress(p))
    const offDone = window.api.onJobDone((d) => {
      setJobId(null)
      setProgress(null)
      if (d.ok) {
        setDone(true)
        setJobError(null)
        setAppleMusicMsg(d.result.appleMusic?.message ?? null)
      } else if (d.error.code !== 'CANCELLED') {
        setJobError(d.error)
      }
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

  // capability ベース UI 適応：音声のみソースでは動画モードを「描画時に」無効化（副作用で
  // state を後追い補正しない＝1フレームのちらつきを防ぐ）。
  const effectiveKind: DownloadKind =
    info && !info.hasVideo && kind === 'video_best' ? 'audio_lossless' : kind

  const formatChoices = useMemo<FormatOption[]>(() => {
    if (!info) return []
    return effectiveKind === 'video_best'
      ? info.formats.filter((f) => f.isVideo)
      : info.formats.filter((f) => f.isAudio)
  }, [info, effectiveKind])

  async function onProbe(): Promise<void> {
    setProbing(true)
    setProbeError(null)
    setInfo(null)
    setDone(false)
    setJobError(null)
    setFormatId('')
    try {
      const result = await window.api.probe(url)
      setInfo(result)
    } catch (e) {
      setProbeError(toAppError(e))
    } finally {
      setProbing(false)
    }
  }

  async function onDownload(): Promise<void> {
    if (!info) return
    setJobError(null)
    setDone(false)
    setAppleMusicMsg(null)
    try {
      const id = await window.api.startDownload({
        url: info.webpageUrl || url,
        kind: effectiveKind,
        formatId: formatId || undefined,
        outputDir,
        embedMetadata: settings?.embedMetadata,
        embedThumbnail: settings?.embedThumbnail,
        noPlaylist: info.isPlaylist ? noPlaylist : undefined,
        cookiesFromBrowser: settings?.cookiesFromBrowser ?? undefined,
        addToAppleMusic,
        itunesAutoAddDir: itunesDir ?? undefined
      })
      setJobId(id)
    } catch (e) {
      setJobError(toAppError(e))
    }
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
      setJobError(toAppError(e))
    }
  }

  async function onCancel(): Promise<void> {
    try {
      if (jobId) await window.api.cancelDownload(jobId)
    } finally {
      setJobId(null)
      setProgress(null)
    }
  }

  async function onPickFolder(): Promise<void> {
    try {
      const dir = await window.api.pickFolder()
      if (dir) {
        setOutputDir(dir)
        void window.api.setSettings({ outputDir: dir })
      }
    } catch (e) {
      setJobError(toAppError(e))
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

  const isPost = progress?.status === 'postprocessing'
  const statusText = !progress
    ? ''
    : progress.status === 'analyzing'
      ? '解析中…'
      : progress.status === 'queued'
        ? '待機中…'
        : isPost
          ? '変換中…（結合 / 変換）'
          : 'ダウンロード中'

  return (
    <div className="app">
      <header>
        <h1>
          <Film size={22} className="logo" />
          Media Downloader
        </h1>
        <span className="engine">yt-dlp {engineVer}</span>
      </header>

      <section className="row">
        <input
          className="url"
          placeholder="動画 / 音声の URL を貼り付け"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !probing && url && void onProbe()}
          disabled={probing || downloading}
        />
        <button className="primary" onClick={onProbe} disabled={!url || probing || downloading}>
          {probing ? <LoaderCircle size={16} className="spin" /> : <Search size={16} />}
          {probing ? '解析中…' : '解析'}
        </button>
      </section>

      {probeError && <ErrorBox error={probeError} show={showDetail} onToggle={() => setShowDetail((v) => !v)} />}

      {info && (
        <section className="info">
          <div className="info-head">
            {info.thumbnailUrl && <img src={info.thumbnailUrl} alt="" className="thumb" />}
            <div>
              <div className="title">{info.title}</div>
              <div className="meta">
                {info.uploader ?? info.extractor}
                {info.durationSec != null && ` · ${formatDuration(info.durationSec)}`}
                {!info.hasVideo && ' · 音声のみ'}
                {info.isPlaylist && ` · プレイリスト(${info.playlistCount ?? '?'}件)`}
              </div>
            </div>
          </div>

          <fieldset className="kinds" disabled={downloading}>
            <legend>種別</legend>
            {(Object.keys(KIND_LABEL) as DownloadKind[]).map((k) => {
              const disabled = k === 'video_best' && !info.hasVideo
              return (
                <label key={k} className={disabled ? 'disabled' : ''}>
                  <input
                    type="radio"
                    name="kind"
                    checked={effectiveKind === k}
                    disabled={disabled}
                    onChange={() => {
                      setKind(k)
                      setFormatId('')
                    }}
                  />
                  {KIND_LABEL[k]}
                  {disabled && <span className="hint">（このソースには映像がありません）</span>}
                </label>
              )
            })}
          </fieldset>

          <div className="row">
            <label className="field">
              品質
              <select value={formatId} onChange={(e) => setFormatId(e.target.value)} disabled={downloading}>
                <option value="">おまかせ最高</option>
                {formatChoices.map((f) => (
                  <option key={f.formatId} value={f.formatId}>
                    {formatLabel(f)}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {info.isPlaylist && (
            <label className="checkbox">
              <input type="checkbox" checked={noPlaylist} onChange={(e) => setNoPlaylist(e.target.checked)} disabled={downloading} />
              この1件のみ取得（プレイリスト全体を取得しない）
            </label>
          )}
        </section>
      )}

      <section className="row">
        <label className="field grow">
          保存先
          <input value={outputDir} readOnly />
        </label>
        <button onClick={onPickFolder} disabled={downloading}>
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
            disabled={downloading}
          />
          ダウンロード後に Apple Music へ追加（iTunes 経由・iCloudで iPhone に同期）
        </label>
        {addToAppleMusic && (
          <div className="subhint">
            <span>
              {itunesDir
                ? `追加先: ${itunesDir}`
                : '※ クラシック iTunes が必要です。フォルダが自動検出できない場合は指定してください。'}
            </span>
            <button className="link" onClick={onPickItunesDir} disabled={downloading}>
              {itunesDir ? 'フォルダを変更' : 'フォルダを指定'}
            </button>
          </div>
        )}
      </section>

      <section className="actions">
        {!downloading ? (
          <button className="primary big" onClick={onDownload} disabled={!info}>
            <Download size={18} />
            ダウンロード
          </button>
        ) : (
          <button className="danger big" onClick={onCancel}>
            <X size={18} />
            キャンセル
          </button>
        )}
      </section>

      {progress && (
        <section className="progress">
          <div className="bar">
            <div
              className={`fill ${isPost ? 'post' : ''}`}
              style={{ width: `${progress.percent ?? (isPost ? 100 : 0)}%` }}
            />
          </div>
          <div className="progress-meta">
            <span>{statusText}</span>
            <span>
              {progress.percent != null && `${progress.percent.toFixed(1)}%`}
              {progress.speedBps != null && ` · ${formatSpeed(progress.speedBps)}`}
              {progress.etaSec != null && ` · 残り ${formatDuration(progress.etaSec)}`}
            </span>
          </div>
        </section>
      )}

      {done && (
        <section className="done">
          <div className="done-head">
            <span className="done-msg">
              <CircleCheck size={18} />
              保存しました
            </span>
            <button onClick={() => window.api.openFolder(outputDir)}>
              <FolderOpen size={16} />
              保存先フォルダを開く
            </button>
          </div>
          {appleMusicMsg && <p className="applemusic-result">{appleMusicMsg}</p>}
        </section>
      )}

      {jobError && <ErrorBox error={jobError} show={showDetail} onToggle={() => setShowDetail((v) => !v)} />}

      {showDisclaimer && (
        <DisclaimerModal
          onAccept={acceptDisclaimer}
          onClose={reshow ? () => setShowDisclaimer(false) : undefined}
        />
      )}
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
