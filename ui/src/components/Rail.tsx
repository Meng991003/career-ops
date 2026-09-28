import { LINE, OFF_LINE, stationOf } from '@/lib/rows'

// The pipeline drawn as a transit line: stations are the on-line statuses in
// order; Rejected / Discarded / SKIP are where an application leaves the line.

/** Per-row rail: how far along the line this application has travelled. */
export function StageRail({ status, size = 'sm' }: { status: string; size?: 'sm' | 'lg' }) {
  const at = stationOf(status)
  const off = at === -1
  const dot = size === 'lg' ? 'size-3' : 'size-2'
  const gap = size === 'lg' ? 'w-8' : 'w-3.5'
  return (
    <span className="inline-flex items-center" role="img"
      aria-label={off ? `${status} — left the pipeline` : `${status}, stage ${at + 1} of ${LINE.length}`}>
      {LINE.map((s, i) => (
        <span key={s} className="inline-flex items-center">
          {i > 0 && <span className={`h-0.5 ${gap} ${!off && i <= at ? 'bg-line' : 'bg-border'}`} />}
          <span className={`${dot} rounded-full border-2 ${
            off ? 'border-muted-foreground/40 bg-card'
              : i < at ? 'border-line bg-line'
              : i === at ? 'border-line bg-card ring-2 ring-line/25'
              : 'border-border bg-card'}`} />
        </span>
      ))}
      {off && <span className={`${size === 'lg' ? 'ml-2 text-sm' : 'ml-1.5 text-xs'} font-semibold text-muted-foreground`} aria-hidden>✕</span>}
    </span>
  )
}

/** Top rail: every station with its count; clicking a station filters the list. */
export function PipelineRail({ counts, selected, onToggle }: {
  counts: Record<string, number>
  selected: string[]
  onToggle: (status: string) => void
}) {
  const Stop = ({ s, onLine }: { s: string; onLine: boolean }) => {
    const on = selected.includes(s)
    return (
      <button type="button" onClick={() => onToggle(s)} aria-pressed={on}
        className={`group flex flex-col items-start gap-1.5 rounded-lg px-2 pt-1.5 pb-1 text-left transition-colors hover:bg-accent ${on ? 'bg-accent' : ''}`}>
        <span className={`font-mono text-3xl font-semibold leading-none tabular-nums ${on ? 'text-line' : counts[s] ? 'text-foreground' : 'text-muted-foreground/40'}`}>
          {counts[s] ?? 0}
        </span>
        <span className={`text-[11px] font-semibold uppercase tracking-wider ${on ? 'text-line' : 'text-muted-foreground'}`}>
          {s === 'SKIP' ? 'Skipped' : s}
        </span>
        {onLine && <span className={`mt-1 size-3.5 rounded-full border-[3px] ${on || counts[s] ? 'border-line' : 'border-border'} ${on ? 'bg-line' : 'bg-card'}`} />}
      </button>
    )
  }
  return (
    <nav aria-label="Filter by stage" className="-mx-1 overflow-x-auto pb-1">
      <div className="flex min-w-max items-end gap-6">
        <div className="relative flex items-end gap-5">
          {/* the line itself, running behind the station dots */}
          <span aria-hidden className="absolute inset-x-5 bottom-[0.66rem] h-[3px] rounded-full bg-line/25" />
          {LINE.map(s => <div key={s} className="relative"><Stop s={s} onLine /></div>)}
        </div>
        <div className="flex items-end gap-1 border-l border-dashed border-border pl-4">
          <span className="self-center pr-1 text-[11px] uppercase tracking-wider text-muted-foreground">Off the line</span>
          {OFF_LINE.map(s => <Stop key={s} s={s} onLine={false} />)}
        </div>
      </div>
    </nav>
  )
}
