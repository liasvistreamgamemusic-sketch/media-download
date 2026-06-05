import { resolve } from 'path'
import { defineConfig } from 'vitest/config'

// 純粋関数（src/engine, src/shared）を electron 非依存で node 環境テストする。
// electron.vite.config.ts は再利用しない。
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/{engine,shared}/**/*.{test,spec}.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/engine/**/*.ts', 'src/shared/**/*.ts'],
      exclude: ['**/*.{test,spec}.ts', '**/*.d.ts']
    }
  },
  resolve: {
    alias: {
      '@shared': resolve('src/shared'),
      '@engine': resolve('src/engine')
    }
  }
})
