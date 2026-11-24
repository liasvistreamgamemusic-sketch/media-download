// zip から 1 エントリだけを取り出す最小実装（deno の配布 zip 展開用）。
// OS の unzip / tar に依存しないため、Linux の最小環境や Windows でも同じ動作になる。
// 対応: 無圧縮(0) / deflate(8)。ZIP64・暗号化は非対応（deno の配布物は該当しない）。
import { inflateRawSync } from 'node:zlib'

const EOCD_SIG = 0x06054b50
const CEN_SIG = 0x02014b50
const LOC_SIG = 0x04034b50
const EOCD_MIN = 22
const EOCD_MAX_COMMENT = 0xffff

function findEocd(buf: Buffer): number {
  const stop = Math.max(0, buf.length - EOCD_MIN - EOCD_MAX_COMMENT)
  for (let i = buf.length - EOCD_MIN; i >= stop; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) return i
  }
  throw new Error('zip: end of central directory が見つかりません')
}

/** name に一致する（ディレクトリ部分は無視して basename で比較する）エントリの中身を返す。 */
export function extractZipEntry(zip: Buffer, name: string): Buffer {
  const eocd = findEocd(zip)
  const count = zip.readUInt16LE(eocd + 10)
  let p = zip.readUInt32LE(eocd + 16)

  for (let i = 0; i < count; i++) {
    if (zip.readUInt32LE(p) !== CEN_SIG) throw new Error('zip: central directory が壊れています')
    const flags = zip.readUInt16LE(p + 8)
    const method = zip.readUInt16LE(p + 10)
    const compSize = zip.readUInt32LE(p + 20)
    const size = zip.readUInt32LE(p + 24)
    const nameLen = zip.readUInt16LE(p + 28)
    const extraLen = zip.readUInt16LE(p + 30)
    const commentLen = zip.readUInt16LE(p + 32)
    const localOffset = zip.readUInt32LE(p + 42)
    const entryName = zip.toString('utf8', p + 46, p + 46 + nameLen)
    p += 46 + nameLen + extraLen + commentLen

    if (entryName.split('/').pop() !== name) continue
    if (flags & 0x1) throw new Error('zip: 暗号化エントリは非対応です')

    if (zip.readUInt32LE(localOffset) !== LOC_SIG) throw new Error('zip: local header が壊れています')
    const locNameLen = zip.readUInt16LE(localOffset + 26)
    const locExtraLen = zip.readUInt16LE(localOffset + 28)
    const start = localOffset + 30 + locNameLen + locExtraLen
    const data = zip.subarray(start, start + compSize)

    const out = method === 0 ? Buffer.from(data) : method === 8 ? inflateRawSync(data) : null
    if (!out) throw new Error(`zip: 圧縮方式 ${method} は非対応です`)
    if (out.length !== size) throw new Error('zip: 展開後のサイズが一致しません')
    return out
  }
  throw new Error(`zip: ${name} が見つかりません`)
}
