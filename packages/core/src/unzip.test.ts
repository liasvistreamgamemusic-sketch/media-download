import { describe, it, expect } from 'vitest'
import { deflateRawSync } from 'node:zlib'
import { extractZipEntry } from './unzip.js'

/** テスト用の最小 zip を組み立てる（method 0 = 無圧縮 / 8 = deflate） */
function makeZip(entries: { name: string; data: Buffer; method: 0 | 8 }[]): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const e of entries) {
    const comp = e.method === 8 ? deflateRawSync(e.data) : e.data
    const name = Buffer.from(e.name, 'utf8')
    const loc = Buffer.alloc(30)
    loc.writeUInt32LE(0x04034b50, 0)
    loc.writeUInt16LE(e.method, 8)
    loc.writeUInt32LE(comp.length, 18)
    loc.writeUInt32LE(e.data.length, 22)
    loc.writeUInt16LE(name.length, 26)
    const cen = Buffer.alloc(46)
    cen.writeUInt32LE(0x02014b50, 0)
    cen.writeUInt16LE(e.method, 10)
    cen.writeUInt32LE(comp.length, 20)
    cen.writeUInt32LE(e.data.length, 24)
    cen.writeUInt16LE(name.length, 28)
    cen.writeUInt32LE(offset, 42)
    locals.push(loc, name, comp)
    centrals.push(cen, name)
    offset += loc.length + name.length + comp.length
  }
  const cd = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(cd.length, 12)
  eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, cd, eocd])
}

describe('extractZipEntry', () => {
  const payload = Buffer.from('#!/bin/deno binary '.repeat(500))

  it('extracts a deflated entry by basename', () => {
    const zip = makeZip([
      { name: 'README.txt', data: Buffer.from('hi'), method: 0 },
      { name: 'bin/deno', data: payload, method: 8 }
    ])
    expect(extractZipEntry(zip, 'deno').equals(payload)).toBe(true)
  })

  it('extracts a stored entry', () => {
    const zip = makeZip([{ name: 'deno.exe', data: payload, method: 0 }])
    expect(extractZipEntry(zip, 'deno.exe').equals(payload)).toBe(true)
  })

  it('throws when the entry is missing or the buffer is not a zip', () => {
    expect(() => extractZipEntry(makeZip([{ name: 'a', data: payload, method: 8 }]), 'deno')).toThrow(/見つかりません/)
    expect(() => extractZipEntry(Buffer.from('not a zip at all, definitely not'), 'deno')).toThrow()
  })
})
