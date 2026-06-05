import { app } from 'electron'
import { appendFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'

type Level = 'info' | 'warn' | 'error'

let logFile: string | null = null

async function ensureLogFile(): Promise<string> {
  if (logFile) return logFile
  const dir = join(app.getPath('userData'), 'logs')
  await mkdir(dir, { recursive: true })
  logFile = join(dir, 'app.log')
  return logFile
}

function ts(): string {
  // 時刻は副作用扱い。logger 内に閉じ込める。
  return new Date().toISOString()
}

async function write(level: Level, msg: string, meta?: Record<string, unknown>): Promise<void> {
  const line = JSON.stringify({ ts: ts(), level, msg, ...meta })
  // コンソールにも出す（dev で確認しやすく）
  if (level === 'error') console.error(line)
  else console.log(line)
  try {
    const file = await ensureLogFile()
    await appendFile(file, line + '\n', 'utf8')
  } catch {
    // ログ書き込み失敗はアプリ動作を止めない
  }
}

export const logger = {
  info: (msg: string, meta?: Record<string, unknown>) => void write('info', msg, meta),
  warn: (msg: string, meta?: Record<string, unknown>) => void write('warn', msg, meta),
  error: (msg: string, meta?: Record<string, unknown>) => void write('error', msg, meta)
}
