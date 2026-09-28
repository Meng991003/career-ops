import type { Row } from './rows'

// Only live applications: the stations after Evaluated. Evaluated (the inbox)
// and the off-line statuses stay in the Applications list.
export const BOARD = ['Applied', 'Responded', 'Interview', 'Offer', 'Hired']

export function columns(rows: Row[], appliedOn: Record<string, string>): Record<string, Row[]> {
  const when = (r: Row) => appliedOn[r['#']] ?? r.Date ?? ''
  const out: Record<string, Row[]> = Object.fromEntries(BOARD.map(s => [s, [] as Row[]]))
  for (const r of rows) if (out[r.Status]) out[r.Status].push(r)
  for (const s of BOARD) out[s].sort((a, b) => when(a).localeCompare(when(b)))
  return out
}

export function dropMove(from: string, to: string): string | null {
  return BOARD.includes(from) && from !== to && BOARD.includes(to) ? to : null
}
