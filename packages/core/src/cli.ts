#!/usr/bin/env node
// `media-dl` コマンドの実行入口。ロジックは cliRun.ts（テスト可能）に置く。
import { createRequire } from 'node:module'
import { runCli } from './cliRun.js'

const pkg = createRequire(import.meta.url)('../package.json') as { version: string }

const controller = new AbortController()
// 1 回目の Ctrl+C で yt-dlp をプロセスツリーごと止めて一時ファイルを片付ける。2 回目は即終了。
process.once('SIGINT', () => {
  controller.abort()
  process.once('SIGINT', () => process.exit(130))
})

const code = await runCli(process.argv.slice(2), {
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
  isTTY: process.stderr.isTTY === true,
  version: pkg.version,
  signal: controller.signal
})
process.exitCode = code
