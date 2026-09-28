import { describe, expect, it } from 'vitest'
import { BOARD, columns, dropMove } from './board'

const r = (num: string, Status: string, Date = '2026-09-01') => ({ '#': num, Status, Date, Company: 'c', Role: 'r', Score: '3.0/5' })

describe('columns', () => {
  it('keeps only board statuses, oldest applied first, preferring the status-log date', () => {
    const cols = columns([r('1', 'Applied', '2026-09-10'), r('2', 'Applied', '2026-09-01'), r('3', 'Evaluated'), r('4', 'Interview')], { '1': '2026-08-20' })
    expect(Object.keys(cols)).toEqual(BOARD)
    expect(cols.Applied.map(x => x['#'])).toEqual(['1', '2'])
    expect(cols.Interview.map(x => x['#'])).toEqual(['4'])
    expect(cols.Hired).toEqual([])
  })
})

describe('dropMove', () => {
  it('moves only between different board columns', () => {
    expect(dropMove('Applied', 'Interview')).toBe('Interview')
    expect(dropMove('Applied', 'Applied')).toBeNull()
    expect(dropMove('Applied', 'Rejected')).toBeNull()
  })

  it('rejects an unknown from (e.g. a missing drag payload)', () => {
    expect(dropMove(undefined as unknown as string, 'Interview')).toBeNull()
    expect(dropMove('', 'Interview')).toBeNull()
  })
})
