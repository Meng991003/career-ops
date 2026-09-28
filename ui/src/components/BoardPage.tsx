import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { getApplications, patchApplication, type ListResponse } from '@/lib/api'
import { BOARD, columns, dropMove } from '@/lib/board'
import { scoreOf, viaOf } from '@/lib/rows'

// Drag a card to another column to change its status (via set-status.mjs).
// Keyboard and touch users change status in the drawer — every card opens it.
export function BoardPage({ onOpen, refreshKey }: { onOpen: (num: string) => void; refreshKey: number }) {
  const [data, setData] = useState<ListResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [over, setOver] = useState<string | null>(null)
  const [reload, setReload] = useState(0)
  useEffect(() => { getApplications().then(setData, e => setError(e.message)) }, [refreshKey, reload])
  const cols = useMemo(() => (data ? columns(data.rows, data.appliedOn) : null), [data])

  if (error) return <p className="rounded-lg border border-destructive/30 bg-card p-4 text-sm text-destructive">Couldn't read the tracker: {error}</p>
  if (!cols) return <p className="text-sm text-muted-foreground">Loading…</p>

  async function drop(num: string, from: string, to: string) {
    setOver(null)
    const target = dropMove(from, to)
    if (!target) return
    try {
      await patchApplication(num, { status: target })
      toast.success(`#${num} → ${target}`)
      setReload(k => k + 1)
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  return (
    <>
      <p className="mb-4 text-sm text-muted-foreground">Drag a card to move it along. Open a card to change its status from the keyboard.</p>
      <div className="-mx-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
        <div className="grid min-w-[56rem] grid-cols-5 gap-3">
          {BOARD.map(s => (
            <section key={s} aria-label={`${s} column`}
              onDragOver={e => { e.preventDefault(); setOver(s) }}
              onDragLeave={() => setOver(o => (o === s ? null : o))}
              onDrop={e => { const [num, from] = e.dataTransfer.getData('text/plain').split('|'); drop(num, from, s) }}
              className={`flex max-h-[70vh] flex-col rounded-xl border bg-muted/40 transition-colors ${over === s ? 'border-line bg-accent' : ''}`}>
              <header className="flex items-baseline justify-between px-3 py-2.5">
                <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{s}</h2>
                <span className="font-mono text-sm text-muted-foreground">{cols[s].length}</span>
              </header>
              <ul className="flex-1 space-y-2 overflow-y-auto px-2 pb-2">
                {cols[s].length === 0 && <li className="rounded-lg border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">Drop here</li>}
                {cols[s].map(r => {
                  const score = scoreOf(r)
                  return (
                    <li key={r['#']}>
                      <button type="button" draggable onClick={() => onOpen(r['#'])}
                        onDragStart={e => { e.dataTransfer.setData('text/plain', `${r['#']}|${r.Status}`); e.dataTransfer.effectAllowed = 'move' }}
                        className="w-full cursor-grab rounded-lg border bg-card px-3 py-2 text-left shadow-xs transition-colors hover:border-line/50 active:cursor-grabbing">
                        <span className="flex items-baseline justify-between gap-2">
                          <span className="truncate text-sm font-semibold">{r.Company === '?' ? 'Undisclosed' : r.Company}</span>
                          <span className={`font-mono text-xs ${score !== null && score >= 4 ? 'font-semibold text-signal' : 'text-muted-foreground'}`}>{score?.toFixed(1) ?? '—'}</span>
                        </span>
                        <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">{r.Role}</span>
                        <span className="mt-1 block font-mono text-[11px] text-muted-foreground">
                          #{r['#']} · {data!.appliedOn[r['#']] ?? r.Date}{viaOf(r) ? ` · via ${viaOf(r)}` : ''}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </>
  )
}
