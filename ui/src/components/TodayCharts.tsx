import { useState } from 'react'
import { donutArcs, pipelineSplit, rangeScale, type Segment } from '@/lib/charts'
import type { RateCalibration } from '@/lib/api'

// Three small charts for Today, each the form its data calls for: a donut for a
// three-part whole, a meter for one ratio, a range bar for "you vs typical".
// The accent (--mark) marks the one thing each chart is about; context is gray.

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <figure className="flex min-w-0 flex-col rounded-xl border bg-card p-4">
      <figcaption className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</figcaption>
      {children}
    </figure>
  )
}

const SEGMENT_STYLE: Record<Segment['key'], { stroke: string; swatch: string }> = {
  open: { stroke: 'stroke-mark', swatch: 'bg-mark' },
  waiting: { stroke: 'stroke-muted-foreground/45', swatch: 'bg-muted-foreground/45' },
  done: { stroke: 'stroke-muted-foreground/20', swatch: 'bg-muted-foreground/20' },
}

const R = 46, STROKE = 14, C = 2 * Math.PI * R, GAP = 2

export function PipelineDonut({ byStatus }: { byStatus: Record<string, number> }) {
  const [hot, setHot] = useState<number | null>(null)
  const segs = pipelineSplit(byStatus)
  const total = segs.reduce((n, s) => n + s.value, 0)
  const arcs = donutArcs(segs.map(s => s.value), C, GAP)
  const focus = hot !== null ? segs[hot] : null
  return (
    <ChartCard title="Where your applications are">
      {total === 0 ? <p className="text-sm text-muted-foreground">Nothing tracked yet. Evaluate a job to start.</p> : (
        <div className="flex items-center gap-4">
          <svg viewBox="0 0 120 120" className="size-32 shrink-0" role="img"
            aria-label={segs.map(s => `${s.label}: ${s.value}`).join(', ')}>
            {segs.map((s, i) => (
              <circle key={s.key} cx="60" cy="60" r={R} fill="none" strokeWidth={STROKE}
                className={`${SEGMENT_STYLE[s.key].stroke} transition-opacity ${hot !== null && hot !== i ? 'opacity-40' : ''}`}
                strokeDasharray={`${arcs[i].length} ${C - arcs[i].length}`} strokeDashoffset={-arcs[i].start}
                transform="rotate(-90 60 60)" tabIndex={0} aria-label={`${s.label}: ${s.value}`}
                onMouseEnter={() => setHot(i)} onMouseLeave={() => setHot(null)} onFocus={() => setHot(i)} onBlur={() => setHot(null)} />
            ))}
            <text x="60" y="58" textAnchor="middle" className="fill-foreground font-mono text-[22px] font-semibold">{focus ? focus.value : total}</text>
            <text x="60" y="76" textAnchor="middle" className="fill-muted-foreground text-[9px]">{focus ? `${Math.round((focus.value / total) * 100)}%` : 'tracked'}</text>
          </svg>
          <ul className="min-w-0 space-y-1.5 text-sm">
            {segs.map((s, i) => (
              <li key={s.key} className={`flex items-center gap-2 ${hot !== null && hot !== i ? 'opacity-60' : ''}`}>
                <span aria-hidden className={`size-2.5 shrink-0 rounded-sm ${SEGMENT_STYLE[s.key].swatch}`} />
                <span className="truncate">{s.label}</span>
                <span className="ml-auto pl-2 font-mono tabular-nums text-muted-foreground">{s.value}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </ChartCard>
  )
}

export function FollowUpMeter({ due, live }: { due: number; live: number }) {
  const pct = live ? Math.min(100, (due / live) * 100) : 0
  return (
    <ChartCard title="Follow-ups due">
      {live === 0 ? <p className="text-sm text-muted-foreground">No live applications yet. Follow-ups start once you apply.</p> : (
        <>
          <p className="mb-3 text-sm text-muted-foreground">
            <span className="font-mono text-3xl font-semibold text-foreground">{due}</span> of <span className="font-mono text-foreground">{live}</span> live applications
          </p>
          <div className="h-2.5 rounded-full bg-line/15" role="meter" aria-valuemin={0} aria-valuemax={live} aria-valuenow={due}
            aria-label={`${due} of ${live} live applications are due a follow-up`}>
            <div className="h-full rounded-full bg-mark" style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {due === 0 ? 'Everything is within its follow-up window.' : 'The best-fit ones are listed below.'}
          </p>
        </>
      )}
    </ChartCard>
  )
}

export function ReplyRange({ rate, sentence }: { rate: RateCalibration; sentence: string }) {
  const [lo, hi] = rate.rangePct
  const max = rangeScale(rate.ownPct, rate.rangePct)
  const at = (v: number) => `${(Math.min(v, max) / max) * 100}%`
  return (
    <ChartCard title="Reply rate">
      <div className="relative mb-1 mt-6 h-2.5 rounded-full bg-muted"
        role="img" aria-label={`Your reply rate ${rate.ownPct}%, typical ${lo}–${hi}%`}>
        <div className="absolute inset-y-0 rounded-full bg-line/25" style={{ left: at(lo), width: `calc(${at(hi)} - ${at(lo)})` }} />
        <span className="absolute -top-5 -translate-x-1/2 whitespace-nowrap text-[11px] text-muted-foreground" style={{ left: `calc((${at(lo)} + ${at(hi)}) / 2)` }}>
          typical {lo}–{hi}%
        </span>
        <span className="absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground ring-2 ring-card" style={{ left: at(rate.ownPct) }} />
      </div>
      <div className="mb-3 flex justify-between font-mono text-[11px] text-muted-foreground"><span>0%</span><span>{max}%</span></div>
      <p className="text-sm text-muted-foreground">{sentence}</p>
    </ChartCard>
  )
}
