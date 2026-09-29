// Pure maths behind the Today charts; the components only draw.

export type Segment = { key: 'waiting' | 'open' | 'done'; label: string; value: number }

// Three states an application can be in — few, clearly different segments,
// which is the only case a donut reads well.
const GROUPS: { key: Segment['key']; label: string; statuses: string[] }[] = [
  { key: 'waiting', label: 'Waiting on you', statuses: ['Evaluated'] },
  { key: 'open', label: 'Sent, still open', statuses: ['Applied', 'Responded', 'Interview', 'Offer'] },
  { key: 'done', label: 'Done', statuses: ['Hired', 'Rejected', 'Discarded', 'SKIP'] },
]

export function pipelineSplit(byStatus: Record<string, number>): Segment[] {
  return GROUPS
    .map(g => ({ key: g.key, label: g.label, value: g.statuses.reduce((n, s) => n + (byStatus[s] ?? 0), 0) }))
    .filter(s => s.value > 0)
}

/** Stroke-dash layout for a ring: each segment's share of the circumference,
 * shortened by `gap` so segments are separated by a surface gap. */
export function donutArcs(values: number[], circumference: number, gap: number): { start: number; length: number }[] {
  const total = values.reduce((a, b) => a + b, 0)
  if (values.length === 1) return [{ start: 0, length: circumference }]
  let start = 0
  return values.map(v => {
    const share = total ? (v / total) * circumference : 0
    const arc = { start, length: Math.max(0, share - gap) }
    start += share
    return arc
  })
}

/** Upper end (in %) of the reply-rate scale: the typical band and the own
 * value both fit, with a little headroom. */
export function rangeScale(ownPct: number, [, hi]: [number, number]): number {
  return Math.max(15, hi + 2, Math.ceil(ownPct * 1.2))
}
