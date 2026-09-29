import { describe, expect, it } from 'vitest'
import { donutArcs, pipelineSplit, rangeScale } from './charts'

describe('pipelineSplit', () => {
  it('groups statuses into waiting / open / done and drops empty groups', () => {
    const s = pipelineSplit({ Evaluated: 209, Applied: 130, Responded: 0, Interview: 1, Offer: 0, Hired: 0, Rejected: 2, Discarded: 5, SKIP: 68 })
    expect(s.map(x => [x.key, x.value])).toEqual([['waiting', 209], ['open', 131], ['done', 75]])
    expect(pipelineSplit({ Evaluated: 3 }).map(x => x.key)).toEqual(['waiting'])
  })
})

describe('donutArcs', () => {
  it('gives each segment its share of the circumference minus a gap, laid end to end', () => {
    const arcs = donutArcs([1, 1, 2], 100, 2)
    expect(arcs.map(a => a.length)).toEqual([23, 23, 48])
    expect(arcs.map(a => a.start)).toEqual([0, 25, 50])
  })
  it('a single segment closes the ring with no gap', () => {
    expect(donutArcs([5], 100, 2)).toEqual([{ start: 0, length: 100 }])
  })
})

describe('rangeScale', () => {
  it('keeps the typical band and the own value on the scale with headroom', () => {
    expect(rangeScale(0.8, [2, 13])).toBe(15)
    expect(rangeScale(20, [2, 13])).toBe(24)
  })
})
