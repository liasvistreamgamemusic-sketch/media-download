import { resolve } from 'path'
import { defineConfig } from 'vitest/config'
import { coreAliases } from './core-alias.config'

// アプリ側の純粋関数（src/shared）を electron 非依存で node 環境テストする。
// core パッケージのテストは packages/core で別に実行する（npm test がまとめて呼ぶ）。
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/shared/**/*.{test,spec}.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/shared/**/*.ts'],
      exclude: ['**/*.{test,spec}.ts', '**/*.d.ts']
    }
  },
  resolve: {
    alias: [{ find: '@shared', replacement: resolve('src/shared') }, ...coreAliases]
  }
})
