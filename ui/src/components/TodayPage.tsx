import { useEffect, useState } from 'react'
import { getToday, type Today, type RateCalibration } from '@/lib/api'
import { Button } from '@/components/ui/button'

const ROUTE_LABEL: Record<string, string> = { open: 'Open to apply', 'likely-gated': 'Check apply button', unknown: 'Route unknown' }

function Card({ title, count, children, footer }: { title: string; count?: number; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col rounded-xl border bg-card">
      <header className="flex items-baseline justify-between border-b px-4 py-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</h2>
        {count !== undefined && <span className="font-mono text-sm text-muted-foreground">{count}</span>}
      </header>
      <div className="flex-1">{children}</div>
      {footer && <footer className="border-t px-4 py-2.5 text-sm">{footer}</footer>}
    </section>
  )
}

const Empty = ({ children }: { children: React.ReactNode }) => <p className="px-4 py-6 text-sm text-muted-foreground">{children}</p>

function Score({ value }: { value: number | null }) {
  return <span className={`w-9 shrink-0 font-mono tabular-nums ${value !== null && value >= 4 ? 'font-semibold text-signal' : 'text-muted-foreground'}`}>{value?.toFixed(1) ?? '—'}</span>
}

function RowButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return <button type="button" onClick={onClick} className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-accent/60">{children}</button>
}

function Funnel({ f, rr }: { f: NonNullable<Today['funnel']>; rr?: RateCalibration }) {
  const steps = [['Applied', f.everApplied], ['Responded', f.everResponded], ['Interviewed', f.everInterview], ['Offers', f.everOffer]] as const
  return (
    <section aria-label="Funnel" className="mb-6 flex flex-wrap items-end gap-x-8 gap-y-4 rounded-xl border bg-card px-5 py-4">
      {steps.map(([label, n]) => (
        <div key={label}>
          <div className="font-mono text-3xl font-semibold leading-none tabular-nums">{n}</div>
          <div className="mt-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
        </div>
      ))}
      {rr && (
        <p className="max-w-sm text-sm text-muted-foreground sm:ml-auto">
          <span className="font-mono text-foreground">{rr.ownPct}%</span> of applications got a reply.
          Typical is {rr.rangePct[0]}–{rr.rangePct[1]}%{rr.band === 'below-range' ? ' — worth changing what you send, not how much.' : '.'}
        </p>
      )}
    </section>
  )
}

export function TodayPage({ onOpen, refreshKey }: { onOpen: (num: string) => void; refreshKey: number }) {
  const [t, setT] = useState<Today | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { getToday().then(setT, e => setError(e.message)) }, [refreshKey])

  if (error) return <p className="rounded-lg border border-destructive/30 bg-card p-4 text-sm text-destructive">Couldn't build today's view: {error}. Check that the career-ops server is running, then reload.</p>
  if (!t) return <p className="text-sm text-muted-foreground">Gathering today's view — this runs a few scripts and takes a second or two…</p>

  const copy = (text: string) => navigator.clipboard.writeText(text)

  return (
    <>
      {t.funnel && <Funnel f={t.funnel} rr={t.calibration?.responseRate} />}
      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Follow-ups due" count={t.followUps.total}
          footer={t.followUps.total > t.followUps.items.length && (
            <span className="text-muted-foreground">Showing the {t.followUps.items.length} best-fit. Run <code className="font-mono text-foreground">/career-ops followup</code> for the full list.</span>
          )}>
          {t.followUps.total === 0 ? <Empty>No follow-ups due. Nothing is waiting on you.</Empty> : t.followUps.items.map(f => (
            <RowButton key={f.num} onClick={() => onOpen(f.num)}>
              <Score value={f.score} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{f.company === '?' ? 'Undisclosed employer' : f.company}</span>
                <span className="block truncate text-xs text-muted-foreground">{f.role}</span>
              </span>
              <span className="shrink-0 text-right text-xs text-muted-foreground">
                <span className="block font-mono">{f.daysOverdue}d overdue</span>
                {!f.hasContact && <span className="block">no contact</span>}
              </span>
            </RowButton>
          ))}
        </Card>

        <Card title="Worth applying" count={t.worthApplying.total}
          footer={<a href="#/applications" className="text-line hover:underline">All evaluated roles →</a>}>
          {t.worthApplying.total === 0 ? <Empty>No evaluated role scores 4.0 or more yet. New evaluations land here.</Empty> : t.worthApplying.items.map(w => (
            <RowButton key={w.num} onClick={() => onOpen(w.num)}>
              <Score value={w.score} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{w.company === '?' ? 'Undisclosed employer' : w.company}</span>
                <span className="block truncate text-xs text-muted-foreground">{w.role}</span>
              </span>
            </RowButton>
          ))}
        </Card>

        <Card title={t.digest ? `From the ${t.digest.date} digest` : 'From the digest'} count={t.digest?.total}>
          {!t.digest ? <Empty>No digest data yet. The 9pm scan writes it; you can also run <code className="font-mono text-foreground">/job-search</code>.</Empty>
            : t.digest.items.length === 0 ? <Empty>The latest digest had nothing you can apply to.</Empty>
            : t.digest.items.map(j => (
              <div key={j.url} className="flex items-center gap-3 px-4 py-2.5">
                <span className="min-w-0 flex-1">
                  <a href={j.url} target="_blank" rel="noreferrer" className="block truncate font-medium hover:text-line">{j.title}</a>
                  <span className="block truncate text-xs text-muted-foreground">
                    {j.company || 'Company not shown'} · {j.source}{j.salary ? ` · ${j.salary}` : ''}
                  </span>
                  {j.applyRoute && j.applyRoute !== 'open' && <span className="text-xs text-muted-foreground">{ROUTE_LABEL[j.applyRoute] ?? j.applyRoute}</span>}
                </span>
                <Button size="sm" variant="outline" onClick={() => copy(`/career-ops ${j.url}`)} aria-label={`Copy evaluate command for ${j.title}`}>Copy evaluate</Button>
              </div>
            ))}
        </Card>

        {t.quietInterviews.length > 0 && (
          <Card title="Interviews gone quiet" count={t.quietInterviews.length}>
            {t.quietInterviews.map(q => (
              <RowButton key={q.company + q.lastInterviewDate} onClick={() => q.trackerNums[0] && onOpen(String(q.trackerNums[0]))}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{q.company}</span>
                  <span className="block truncate text-xs text-muted-foreground">{q.role}</span>
                </span>
                <span className="shrink-0 font-mono text-xs text-muted-foreground">{q.daysSinceLastInterview}d since interview</span>
              </RowButton>
            ))}
          </Card>
        )}
      </div>
    </>
  )
}
