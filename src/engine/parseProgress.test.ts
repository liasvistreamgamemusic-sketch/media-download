import { describe, it, expect } from 'vitest'
import { parseProgressLine, parseDownloadPercent } from './parseProgress'

const JID = 'job-1'

describe('parseProgressLine', () => {
  it('returns null for non-PROG lines', () => {
    expect(parseProgressLine('[download] 12.3% of 5MB', JID)).toBeNull()
    expect(parseProgressLine('random log', JID)).toBeNull()
  })

  it('parses a real downloading line (total NA → uses estimate)', () => {
    // 実出力: [PROG]|downloading|3072|NA|126976.0|598.58|NA
    const p = parseProgressLine('[PROG]|downloading|3072|NA|126976.0|598.5879018533591|NA', JID)
    expect(p).not.toBeNull()
    expect(p!.status).toBe('downloading')
    expect(p!.downloadedBytes).toBe(3072)
    expect(p!.totalBytes).toBe(126976)
    expect(p!.speedBps).toBeCloseTo(598.59, 1)
    expect(p!.etaSec).toBeNull()
    expect(p!.percent).toBeCloseTo((3072 / 126976) * 100, 3)
  })

  it('uses total_bytes when present (not estimate)', () => {
    const p = parseProgressLine('[PROG]|downloading|50|100|999|10|5', JID)
    expect(p!.totalBytes).toBe(100)
    expect(p!.percent).toBe(50)
    expect(p!.etaSec).toBe(5)
  })

  it('normalizes NA to null and yields null percent', () => {
    const p = parseProgressLine('[PROG]|downloading|NA|NA|NA|NA|NA', JID)
    expect(p!.downloadedBytes).toBeNull()
    expect(p!.totalBytes).toBeNull()
    expect(p!.percent).toBeNull()
    expect(p!.speedBps).toBeNull()
  })

  it('maps finished → postprocessing', () => {
    const p = parseProgressLine('[PROG]|finished|100|100|100|0|0', JID)
    expect(p!.status).toBe('postprocessing')
  })

  it('maps error → failed', () => {
    const p = parseProgressLine('[PROG]|error|0|NA|NA|NA|NA', JID)
    expect(p!.status).toBe('failed')
  })

  it('caps percent at 100', () => {
    const p = parseProgressLine('[PROG]|downloading|200|100|100|1|0', JID)
    expect(p!.percent).toBe(100)
  })
})

describe('parseDownloadPercent (fallback)', () => {
  it('extracts percent from [download] line', () => {
    const p = parseDownloadPercent('[download]  62.0% of 5.00MiB at 1.0MiB/s', JID)
    expect(p!.percent).toBe(62)
    expect(p!.status).toBe('downloading')
  })

  it('returns null when no percent present', () => {
    expect(parseDownloadPercent('[PROG]|downloading|1|2|3|4|5', JID)).toBeNull()
  })
})
