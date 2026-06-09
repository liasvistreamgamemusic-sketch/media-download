// クラシック iTunes の「Automatically Add to iTunes」フォルダ経由で、ダウンロード済みの
// 音声を Apple Music ライブラリへ追加する。ここにファイルを置くと iTunes（起動時）が自動で
// 取り込み、iCloud ミュージックライブラリ経由で iPhone の純正ミュージックへ同期される
// （要 Apple Music もしくは iTunes Match 契約）。
//
// なぜこの方式か: iPhone の音楽 DB は iOS のデーモンが所有しており、非公開の同期プロトコル
// 以外からの書き込みは無視される。サードパーティ製の同期は各社が独自にリバースエンジニアリング
// し続けているもので再現・保守が非現実的。そこで「同期」という不可能な 1 点だけ Apple 純正
// （iTunes + iCloud）に委ね、その手前（ライブラリへの追加）だけを自動化する。

import { copyFile, rename, access } from 'node:fs/promises'
import { constants, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, extname, join } from 'node:path'
import { logger } from './logger'
import type { AppleMusicOutcome } from '../shared/types'

// iTunes / Apple Music(Music.app) が取り込める音声拡張子。
// opus/webm/ogg/flac などは非対応のため除外する。
const COMPAT_AUDIO_EXT = new Set(['.mp3', '.m4a', '.m4b', '.aac', '.aif', '.aiff', '.wav'])

/** 「自動追加」フォルダの既定候補（プラットフォーム横断）。 */
function defaultAutoAddCandidates(): string[] {
  const home = homedir()
  return [
    // Windows / 旧 iTunes（macOS 旧版も同名）
    join(home, 'Music', 'iTunes', 'iTunes Media', 'Automatically Add to iTunes'),
    join(home, 'Music', 'iTunes', 'iTunes Media', 'Automatically Add to Music'),
    // macOS Music.app
    join(home, 'Music', 'Music', 'Media.localized', 'Automatically Add to Music.localized'),
    join(home, 'Music', 'Music', 'Media', 'Automatically Add to Music.localized')
  ]
}

/** 設定優先で自動追加フォルダを解決。見つからなければ null。 */
export function resolveAutoAddDir(configured: string | null | undefined): string | null {
  if (configured && existsSync(configured)) return configured
  for (const c of defaultAutoAddCandidates()) {
    if (existsSync(c)) return c
  }
  return null
}

/** 衝突しないコピー先パスを決める（同名が残っている場合は連番を付す）。 */
function uniqueDest(dir: string, srcPath: string): string {
  const base = basename(srcPath)
  const ext = extname(base)
  const stem = base.slice(0, base.length - ext.length)
  let dest = join(dir, base)
  let i = 1
  while (existsSync(dest)) {
    dest = join(dir, `${stem} (${i})${ext}`)
    i++
  }
  return dest
}

/**
 * 音声ファイルを iTunes 自動追加フォルダへ配置する。ダウンロード自体は成功扱いのまま、
 * 追加の成否はメッセージで返す（ベストエフォート。失敗してもジョブは失敗にしない）。
 */
export async function addToAppleMusic(
  outputPath: string,
  configuredDir: string | null | undefined
): Promise<AppleMusicOutcome> {
  const ext = extname(outputPath).toLowerCase()
  if (!COMPAT_AUDIO_EXT.has(ext)) {
    return {
      attempted: true,
      added: false,
      message: `この形式（${ext || '不明'}）は Apple Music 非対応のため追加をスキップしました。「音声 mp3」など対応形式で取得してください。`
    }
  }

  if (!existsSync(outputPath)) {
    logger.error('addToAppleMusic: source not found', { outputPath })
    return {
      attempted: true,
      added: false,
      message: `追加元のファイルが見つかりませんでした：${outputPath}`
    }
  }

  const dir = resolveAutoAddDir(configuredDir)
  if (!dir) {
    return {
      attempted: true,
      added: false,
      message:
        'iTunes の自動追加フォルダが見つかりませんでした。クラシック iTunes をインストールするか、設定でフォルダを指定してください。'
    }
  }

  try {
    await access(dir, constants.W_OK)
    const dest = uniqueDest(dir, outputPath)
    // iTunes の監視が取り込み途中の部分ファイルを掴まないよう、.part に書いてから rename。
    const tmp = `${dest}.mdl-part`
    await copyFile(outputPath, tmp)
    await rename(tmp, dest)
    logger.info('added to Apple Music auto-add folder', { dest })
    return {
      attempted: true,
      added: true,
      message:
        'Apple Music ライブラリに追加しました（iTunes 起動時に取り込まれ、iCloud 経由で iPhone の純正ミュージックへ同期されます）。'
    }
  } catch (e) {
    logger.error('addToAppleMusic failed', { error: String(e) })
    return {
      attempted: true,
      added: false,
      message: `Apple Music への追加に失敗しました：${e instanceof Error ? e.message : String(e)}`
    }
  }
}
