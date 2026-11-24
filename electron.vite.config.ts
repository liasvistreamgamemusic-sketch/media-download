import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { CORE_PKG, coreAliases } from './core-alias.config'

const aliases = [{ find: '@shared', replacement: resolve('src/shared') }, ...coreAliases]

export default defineConfig({
  main: {
    // execa と electron-store は ESM-only。CJS main では require できないため
    // externalize から除外してバンドルに取り込む（Strategy A）。
    // core（workspace パッケージ）はソースを直接バンドルする（dist のビルドを開発時に要求しない）。
    plugins: [externalizeDepsPlugin({ exclude: ['execa', 'electron-store', CORE_PKG] })],
    resolve: { alias: aliases }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: aliases }
  },
  renderer: {
    resolve: {
      alias: [...aliases, { find: '@renderer', replacement: resolve('src/renderer/src') }]
    },
    plugins: [react()]
  }
})
