import { useEffect, useMemo, useState } from 'react'
import { getApplications, type ListResponse } from '@/lib/api'
import { applyFilter, EMPTY_FILTER, PRESETS, scoreOf, sortRows, STATUSES, viaOf, type Filter, type SortKey } from '@/lib/rows'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

// Short columns first so Score/Status stay visible on narrow windows; the
// company cell carries the role underneath and wraps; Date hides below sm.
const COLS: { key: SortKey; label: string; className?: string }[] = [
  { key: 'num', label: '#' }, { key: 'score', label: 'Score' }, { key: 'status', label: 'Status' },
  { key: 'company', label: 'Company / role', className: 'w-full' },
  { key: 'date', label: 'Date', className: 'hidden sm:table-cell' },
]

export function ApplicationsTable({ onOpen, refreshKey }: { onOpen: (num: string) => void; refreshKey: number }) {
  const [data, setData] = useState<ListResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>(EMPTY_FILTER)
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'num', desc: true })

  useEffect(() => { getApplications().then(setData, e => setError(e.message)) }, [refreshKey])

  const shown = useMemo(() => {
    if (!data) return []
    return sortRows(applyFilter(data.rows, filter, data.appliedOn), sort.key, sort.desc)
  }, [data, filter, sort])

  if (error) return <p className="p-6 text-sm text-red-600">Could not load the tracker: {error}</p>
  if (!data) return <p className="p-6 text-sm text-muted-foreground">Loading…</p>

  const toggleStatus = (s: string) => setFilter(f => ({
    ...f, statuses: f.statuses.includes(s) ? f.statuses.filter(x => x !== s) : [...f.statuses, s],
  }))

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input className="w-64" placeholder="Search company, role, notes…" value={filter.q}
          onChange={e => setFilter(f => ({ ...f, q: e.target.value }))} />
        {PRESETS.map(p => (
          <Button key={p.label} size="sm" variant="outline" onClick={() => setFilter(p.filter)}>{p.label}</Button>
        ))}
        <Button size="sm" variant="ghost" onClick={() => setFilter(EMPTY_FILTER)}>Clear</Button>
        <span className="ml-auto text-sm text-muted-foreground">{shown.length} of {data.rows.length}</span>
      </div>
      <div className="flex flex-wrap gap-1">
        {STATUSES.map(s => (
          <Badge key={s} className="cursor-pointer select-none" variant={filter.statuses.includes(s) ? 'default' : 'outline'}
            onClick={() => toggleStatus(s)}>{s}</Badge>
        ))}
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            {COLS.map(c => (
              <TableHead key={c.key} className={`cursor-pointer select-none ${c.className ?? ''}`}
                onClick={() => setSort(s => ({ key: c.key, desc: s.key === c.key ? !s.desc : true }))}>
                {c.label}{sort.key === c.key ? (sort.desc ? ' ↓' : ' ↑') : ''}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {shown.map(r => (
            <TableRow key={r['#']} className="cursor-pointer" onClick={() => onOpen(r['#'])}>
              <TableCell className="tabular-nums text-muted-foreground">{r['#']}</TableCell>
              <TableCell className="tabular-nums">{scoreOf(r)?.toFixed(1) ?? '—'}</TableCell>
              <TableCell><Badge variant="secondary">{r.Status}</Badge></TableCell>
              <TableCell className="whitespace-normal [overflow-wrap:anywhere]">
                <div className="font-medium">{r.Company}{viaOf(r) ? <span className="font-normal text-muted-foreground"> via {viaOf(r)}</span> : null}</div>
                <div className="text-muted-foreground">{r.Role}</div>
              </TableCell>
              <TableCell className="hidden tabular-nums sm:table-cell">{r.Date}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
