export type Row = Record<string, string>

// The pipeline is a line with stations in a real order; the other three
// statuses are where an application leaves the line.
export const LINE = ['Evaluated', 'Applied', 'Responded', 'Interview', 'Offer', 'Hired']
export const OFF_LINE = ['Rejected', 'Discarded', 'SKIP']
export const STATUSES = [...LINE, ...OFF_LINE]

export const stationOf = (status: string) => LINE.indexOf(status)

export function scoreOf(r: Row): number | null {
  const m = /^(\d+(?:\.\d+)?)\/5/.exec((r.Score ?? '').trim())
  return m ? Number(m[1]) : null
}

const NO_VALUE = new Set(['', '—', '-'])

export function viaOf(r: Row): string | null {
  const v = (r.Via ?? '').trim()
  return NO_VALUE.has(v) ? null : v
}

export type Filter = { q: string; statuses: string[]; minScore: number | null; appliedOlderThan: number | null }
export const EMPTY_FILTER: Filter = { q: '', statuses: [], minScore: null, appliedOlderThan: null }

// ponytail: fixed presets, not user-saved filters — add persistence when a
// fourth one is actually wanted.
export const PRESETS: { label: string; filter: Filter }[] = [
  { label: 'Worth applying (≥ 4.0)', filter: { ...EMPTY_FILTER, statuses: ['Evaluated'], minScore: 4 } },
  { label: 'Applied > 14 days', filter: { ...EMPTY_FILTER, statuses: ['Applied'], appliedOlderThan: 14 } },
  { label: 'Live', filter: { ...EMPTY_FILTER, statuses: ['Applied', 'Responded', 'Interview', 'Offer'] } },
]

const DAY = 86_400_000
const daysSince = (iso: string, today: Date) => Math.floor((today.getTime() - new Date(`${iso}T00:00:00`).getTime()) / DAY)

export function applyFilter(rows: Row[], f: Filter, appliedOn: Record<string, string>, today = new Date()): Row[] {
  const q = f.q.trim().toLowerCase()
  return rows.filter(r => {
    if (f.statuses.length && !f.statuses.includes(r.Status)) return false
    if (f.minScore !== null && (scoreOf(r) ?? -1) < f.minScore) return false
    if (f.appliedOlderThan !== null) {
      const when = appliedOn[r['#']] ?? r.Date // rows applied before the ledger existed fall back to the row date
      const d = daysSince(when, today)
      if (!when || Number.isNaN(d) || d <= f.appliedOlderThan) return false
    }
    if (q && ![r.Company, r.Role, r.Notes, viaOf(r)].some(v => v?.toLowerCase().includes(q))) return false
    return true
  })
}

export type SortKey = 'num' | 'date' | 'company' | 'score' | 'status'

export function sortRows(rows: Row[], key: SortKey, desc: boolean): Row[] {
  const dir = desc ? -1 : 1
  return [...rows].sort((a, b) => {
    if (key === 'score') {
      const sa = scoreOf(a), sb = scoreOf(b)
      if (sa === null || sb === null) return sa === sb ? 0 : sa === null ? 1 : -1 // unscored always last
      return (sa - sb) * dir
    }
    if (key === 'num') return (Number(a['#']) - Number(b['#'])) * dir
    if (key === 'status') return (stationOf(a.Status) - stationOf(b.Status)) * dir // off-line (-1) sorts past every station
    const field = key === 'date' ? 'Date' : 'Company'
    return (a[field] ?? '').localeCompare(b[field] ?? '') * dir
  })
}
