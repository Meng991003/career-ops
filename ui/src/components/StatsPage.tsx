import { useEffect, useState } from 'react'
import { getStats, type RateCalibration, type StatsResponse } from '@/lib/api'
import { STATUSES } from '@/lib/rows'
import { Bars } from '@/components/Bars'

const HOP_LABEL: Record<string, string> = {
  appliedToResponded: 'Applied → reply', respondedToInterview: 'Reply → interview',
  interviewToOffer: 'Interview → offer', appliedToRejected: 'Applied → rejection',
}

const fmt1 = (n: number | null) => (n === null ? '—' : n.toFixed(1))

function Tile({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border bg-card px-4 py-3">
      <div className="font-mono text-3xl font-semibold leading-none tabular-nums">{value}</div>
      <div className="mt-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
    </div>
  )
}

function Rate({ name, c }: { name: string; c?: RateCalibration }) {
  if (!c) return null
  return (
    <div className="rounded-xl border bg-card px-4 py-3 text-sm">
      <div className="flex items-baseline justify-between">
        <span className="font-semibold">{name}</span>
        <span className="font-mono">{c.ownPct}%</span>
      </div>
      <p className="mt-1 text-muted-foreground">
        Typical {c.rangePct[0]}–{c.rangePct[1]}% — you are {c.band === 'below-range' ? 'below' : c.band === 'above-range' ? 'above' : 'within'} the range.
      </p>
      <p className="mt-1 text-xs text-muted-foreground">{c.source}. {c.caveat}</p>
    </div>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-xl border bg-card px-4 py-3 text-sm text-muted-foreground">{children}</p>
}

const H2 = ({ children }: { children: React.ReactNode }) => (
  <h2 className="mb-3 mt-8 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground first:mt-0">{children}</h2>
)

export function StatsPage() {
  const [s, setS] = useState<StatsResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { getStats().then(setS, e => setError(e.message)) }, [])

  if (error) return <p className="rounded-lg border border-destructive/30 bg-card p-4 text-sm text-destructive">Couldn't load stats: {error}</p>
  if (!s) return <p className="text-sm text-muted-foreground">Crunching the numbers…</p>

  const { tracker, funnel, scan } = s.stats
  const cal = s.velocity.calibration
  const velocity = s.velocity.velocity
  return (
    <>
      <H2>Funnel</H2>
      {funnel ? (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Tile label="Applied" value={funnel.everApplied} />
            <Tile label="Replied" value={funnel.everResponded} />
            <Tile label="Interviewed" value={funnel.everInterview} />
            <Tile label="Offers" value={funnel.everOffer} />
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <Rate name="Reply rate" c={cal?.responseRate} />
            <Rate name="Interview rate" c={cal?.interviewRate} />
          </div>
        </>
      ) : (
        <Empty>No tracker yet — evaluate a job to start.</Empty>
      )}

      <H2>Time between stages</H2>
      {velocity ? (
        <ul className="divide-y rounded-xl border bg-card text-sm">
          {Object.entries(velocity).map(([k, h]) => (
            <li key={k} className="flex items-baseline justify-between px-4 py-2.5">
              <span>{HOP_LABEL[k] ?? `${h.from} → ${h.to}`}</span>
              <span className="font-mono text-muted-foreground">
                {h.insufficientData || h.median === null ? `Not enough data yet (n=${h.n})` : `${h.median} days median`}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <Empty>No status history yet — status changes will populate this.</Empty>
      )}

      <H2>Pipeline</H2>
      {tracker ? (
        <div className="grid gap-3 md:grid-cols-2">
          <Bars title="Applications by status" data={STATUSES.map(st => ({ label: st === 'SKIP' ? 'Skipped' : st, value: tracker.byStatus[st] ?? 0 }))} />
          <div className="grid grid-cols-2 content-start gap-3">
            <Tile label="Tracked" value={tracker.total} />
            <Tile label="Avg fit, applied" value={fmt1(tracker.avgScoreApplied)} />
            <Tile label="Avg fit, all" value={fmt1(tracker.avgScore)} />
            <Tile label="Best fit" value={fmt1(tracker.topScore)} />
          </div>
        </div>
      ) : (
        <Empty>No tracker yet — evaluate a job to start.</Empty>
      )}

      <H2>Scanning</H2>
      {scan ? (
        <>
          <p className="mb-3 text-sm text-muted-foreground">
            <span className="font-mono text-foreground">{scan.totalRecorded.toLocaleString()}</span> postings from{' '}
            <span className="font-mono text-foreground">{scan.distinctCompanies.toLocaleString()}</span> companies since {scan.firstSeen}.
          </p>
          <div className="grid gap-3 md:grid-cols-2">
            <Bars title="New postings per week" orientation="vertical" data={scan.addedPerWeek.map(w => ({ label: w.week, value: w.count }))} />
            <Bars title="Postings by source" data={Object.entries(scan.byPortal).sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value }))} />
          </div>
        </>
      ) : (
        <Empty>No scan history yet — run a scan.</Empty>
      )}
    </>
  )
}
