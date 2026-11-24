// アプリ（electron-vite / vitest）から core パッケージのソースを直接参照するための別名。
// tsconfig.node.json / tsconfig.web.json の paths と同じ対応にすること。
import { resolve } from 'path'

export const CORE_PKG = '@liasvistreamgamemusic-sketch/media-dl'

const coreSrc = resolve(__dirname, 'packages/core/src')

export const coreAliases = [
  { find: new RegExp(`^${CORE_PKG}$`), replacement: resolve(coreSrc, 'index.ts') },
  { find: new RegExp(`^${CORE_PKG}/(.+)$`), replacement: `${coreSrc}/$1.ts` }
]
