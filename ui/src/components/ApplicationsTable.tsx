import { useEffect, useMemo, useState } from 'react'
import { getApplications, type ListResponse } from '@/lib/api'
import { applyFilter, EMPTY_FILTER, PRESETS, scoreOf, sortRows, viaOf, type Filter, type SortKey } from '@/lib/rows'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { PipelineRail, StageRail } from '@/components/Rail'

const SORTS: { value: string; label: string; key: SortKey; desc: boolean }[] = [
  { value: 'newest', label: 'Newest first', key: 'num', desc: true },
  { value: 'score', label: 'Highest score', key: 'score', desc: true },
  { value: 'stage', label: 'Furthest along', key: 'status', desc: true },
  { value: 'company', label: 'Company A–Z', key: 'company', desc: false },
]

// A score of 4.0+ is the "worth applying" bar, so it alone gets the signal colour.
function Score({ value }: { value: number | null }) {
  if (value === null) return <span className="font-mono text-lg text-muted-foreground/50">—</span>
  return <span className={`font-mono text-lg tabular-nums ${value >= 4 ? 'font-semibold text-signal' : value >= 3 ? 'text-foreground' : 'text-muted-foreground'}`}>{value.toFixed(1)}</span>
}

export function ApplicationsTable({ onOpen, refreshKey }: { onOpen: (num: string) => void; refreshKey: number }) {
  const [data, setData] = useState<ListResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>(EMPTY_FILTER)
  const [sortId, setSortId] = useState('newest')

  useEffect(() => { getApplications().then(setData, e => setError(e.message)) }, [refreshKey])

  const counts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const r of data?.rows ?? []) c[r.Status] = (c[r.Status] ?? 0) + 1
    return c
  }, [data])

  const shown = useMemo(() => {
    if (!data) return []
    const s = SORTS.find(x => x.value === sortId)!
    return sortRows(applyFilter(data.rows, filter, data.appliedOn), s.key, s.desc)
  }, [data, filter, sortId])

  if (error) return <p className="rounded-lg border border-destructive/30 bg-card p-4 text-sm text-destructive">Couldn't read the tracker: {error}. Check that the career-ops server is running, then reload.</p>
  if (!data) return <p className="p-4 text-sm text-muted-foreground">Loading applications…</p>

  const toggleStatus = (s: string) => setFilter(f => ({
    ...f, statuses: f.statuses.includes(s) ? f.statuses.filter(x => x !== s) : [...f.statuses, s],
  }))
  const activePreset = PRESETS.find(p => JSON.stringify(p.filter) === JSON.stringify(filter))?.label
  const filtered = JSON.stringify(filter) !== JSON.stringify(EMPTY_FILTER)

  return (
    <div className="space-y-5">
      <PipelineRail counts={counts} selected={filter.statuses} onToggle={toggleStatus} />

      <div className="flex flex-wrap items-center gap-2">
        <Input className="h-9 w-full bg-card sm:w-72" placeholder="Search company, role or notes" value={filter.q}
          aria-label="Search applications" onChange={e => setFilter(f => ({ ...f, q: e.target.value }))} />
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map(p => (
            <button key={p.label} type="button" aria-pressed={activePreset === p.label}
              onClick={() => setFilter(activePreset === p.label ? EMPTY_FILTER : p.filter)}
              className={`h-9 rounded-full border px-3.5 text-sm transition-colors ${activePreset === p.label ? 'border-line bg-line text-primary-foreground' : 'border-border bg-card hover:border-line/50'}`}>
              {p.label}
            </button>
          ))}
        </div>
        <Select value={sortId} onValueChange={setSortId}>
          <SelectTrigger className="h-9 w-40 bg-card sm:ml-auto" aria-label="Sort"><SelectValue /></SelectTrigger>
          <SelectContent>{SORTS.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
        </Select>
      </div>

      <div className="flex items-baseline justify-between text-sm text-muted-foreground">
        <span>Showing <span className="font-mono text-foreground">{shown.length}</span> of {data.rows.length}</span>
        {filtered && <button type="button" className="underline-offset-4 hover:text-foreground hover:underline" onClick={() => setFilter(EMPTY_FILTER)}>Clear filters</button>}
      </div>

      {shown.length === 0 ? (
        <p className="rounded-lg border border-dashed bg-card p-8 text-center text-sm text-muted-foreground">
          No applications match. Try a different search, or clear the filters.
        </p>
      ) : (
        <ul className="overflow-hidden rounded-xl border bg-card">
          {shown.map(r => (
            <li key={r['#']} className="border-b last:border-b-0">
              <button type="button" onClick={() => onOpen(r['#'])}
                className="grid w-full grid-cols-[3rem_1fr] items-center gap-x-4 gap-y-2 px-4 py-3 text-left transition-colors hover:bg-accent/60 sm:grid-cols-[3rem_1fr_auto]">
                <Score value={scoreOf(r)} />
                <span className="min-w-0">
                  <span className="block font-semibold [overflow-wrap:anywhere]">
                    {r.Company === '?' ? <span className="text-muted-foreground">Undisclosed employer</span> : r.Company}
                    {viaOf(r) && <span className="font-normal text-muted-foreground"> via {viaOf(r)}</span>}
                  </span>
                  <span className="block text-sm text-muted-foreground [overflow-wrap:anywhere]">{r.Role}</span>
                </span>
                <span className="col-start-2 flex flex-col gap-1 sm:col-start-3 sm:items-end">
                  <StageRail status={r.Status} />
                  <span className="text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">{r.Status === 'SKIP' ? 'Skipped' : r.Status}</span>
                    <span className="font-mono"> · #{r['#']} · {r.Date}</span>
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
