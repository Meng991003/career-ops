import { describe, expect, it } from 'vitest'
import { applyFilter, EMPTY_FILTER, PRESETS, scoreOf, sortRows, viaOf, type Row } from './rows'

const row = (o: Partial<Row>): Row => ({ '#': '1', Date: '2026-09-01', Company: 'Acme', Role: 'Dev', Score: '4.2/5', Status: 'Evaluated', Notes: '', ...o })
const today = new Date('2026-09-28T12:00:00')
const rows = [
  row({ '#': '1', Score: '4.2/5', Status: 'Evaluated', Company: 'Acme' }),
  row({ '#': '2', Score: '3.1/5', Status: 'Evaluated', Company: 'Globex' }),
  row({ '#': '3', Score: '3.9/5', Status: 'Applied', Company: 'Initech', Date: '2026-09-01' }),
  row({ '#': '4', Score: 'N/A', Status: 'Interview', Company: 'Umbrella', Role: 'Frontend' }),
]
const nums = (rs: Row[]) => rs.map(r => r['#'])

describe('scoreOf', () => {
  it('parses X.X/5 and rejects sentinels', () => {
    expect(scoreOf(rows[0])).toBe(4.2)
    expect(scoreOf(rows[3])).toBeNull()
  })
})

describe('viaOf', () => {
  it('treats —, - and blank as no agency', () => {
    expect(viaOf(row({ Via: '—' }))).toBeNull()
    expect(viaOf(row({ Via: '-' }))).toBeNull()
    expect(viaOf(row({ Via: '' }))).toBeNull()
    expect(viaOf(row({ Via: 'Hays' }))).toBe('Hays')
  })
})

describe('applyFilter', () => {
  it('free text matches company, role and notes, case-insensitively', () => {
    expect(nums(applyFilter(rows, { ...EMPTY_FILTER, q: 'front' }, {}, today))).toEqual(['4'])
  })
  it('status and min score combine', () => {
    expect(nums(applyFilter(rows, { ...EMPTY_FILTER, statuses: ['Evaluated'], minScore: 4 }, {}, today))).toEqual(['1'])
  })
  it('appliedOlderThan prefers the status-log date over the row date', () => {
    const f = { ...EMPTY_FILTER, statuses: ['Applied'], appliedOlderThan: 14 }
    expect(nums(applyFilter(rows, f, {}, today))).toEqual(['3'])            // row date 27 days ago
    expect(nums(applyFilter(rows, f, { '3': '2026-09-25' }, today))).toEqual([]) // applied 3 days ago
  })
  it('excludes an Applied row whose date is the — sentinel and has no appliedOn entry', () => {
    const f = { ...EMPTY_FILTER, statuses: ['Applied'], appliedOlderThan: 14 }
    const withSentinel = [...rows, row({ '#': '5', Status: 'Applied', Date: '—' })]
    expect(nums(applyFilter(withSentinel, f, {}, today))).toEqual(['3'])
  })
  it('every preset is a valid filter', () => {
    for (const p of PRESETS) expect(Array.isArray(applyFilter(rows, p.filter, {}, today))).toBe(true)
  })
})

describe('sortRows', () => {
  it('sorts by score with unscored rows last in both directions', () => {
    expect(nums(sortRows(rows, 'score', true))).toEqual(['1', '3', '2', '4'])
    expect(nums(sortRows(rows, 'score', false))).toEqual(['2', '3', '1', '4'])
  })
  it('sorts by number numerically', () => {
    expect(nums(sortRows([row({ '#': '10' }), row({ '#': '9' })], 'num', false))).toEqual(['9', '10'])
  })
})
