import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

const aliases = {
  '@shared': resolve('src/shared'),
  '@engine': resolve('src/engine')
}

export default defineConfig({
  main: {
    // execa と electron-store は ESM-only。CJS main では require できないため
    // externalize から除外してバンドルに取り込む（Strategy A）。
    plugins: [externalizeDepsPlugin({ exclude: ['execa', 'electron-store'] })],
    resolve: { alias: aliases }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: aliases }
  },
  renderer: {
    resolve: {
      alias: {
        ...aliases,
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [react()]
  }
})
