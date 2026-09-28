import { useEffect, useState } from 'react'
import Markdown from 'react-markdown'
import { getApplication, type Detail } from '@/lib/api'
import { splitReport } from '@/lib/report'
import { scoreOf } from '@/lib/rows'
import { StatusEditor } from '@/components/StatusEditor'
import { StageRail } from '@/components/Rail'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

function CopyPrompt({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border bg-muted/50 p-2 pl-3 text-sm">
      <code className="flex-1 font-mono">{text}</code>
      <Button size="sm" variant="outline" onClick={() => navigator.clipboard.writeText(text)}>Copy</Button>
    </div>
  )
}

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="space-y-2.5"><h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</h3>{children}</section>
)

export function JobDrawer({ num, onClose, onChanged }: { num: string | null; onClose: () => void; onChanged: () => void }) {
  const [d, setD] = useState<Detail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    if (!num) return
    let ignore = false
    setD(null); setError(null)
    getApplication(num).then(v => { if (!ignore) setD(v) }, e => { if (!ignore) setError(e.message) })
    return () => { ignore = true }
  }, [num, reloadKey])

  const reportNum = d?.row.Report?.match(/\[(\d+)\]/)?.[1]
  const url = d?.row.URL?.trim()

  return (
    <Sheet open={num !== null} onOpenChange={open => !open && onClose()}>
      <SheetContent className="w-full overflow-y-auto px-6 pb-10 sm:max-w-3xl">
        {error && <p className="pt-6 text-sm text-destructive">Couldn't load this application: {error}</p>}
        {!d && !error && <p className="text-sm text-muted-foreground">Loading…</p>}
        {d && (
          <div className="space-y-6">
            <SheetHeader className="gap-3 border-b px-0 pb-5">
              <SheetDescription className="font-mono text-xs">
                #{d.row['#']} · {d.row.Date}
                {url && /^https?:\/\//.test(url) && <> · <a className="text-line underline-offset-4 hover:underline" href={url} target="_blank" rel="noreferrer">Open posting ↗</a></>}
              </SheetDescription>
              <SheetTitle className="text-2xl font-extrabold leading-tight tracking-tight">
                {d.row.Company === '?' ? 'Undisclosed employer' : d.row.Company}
                <span className="mt-1 block text-base font-medium text-muted-foreground">{d.row.Role}</span>
              </SheetTitle>
              <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Fit</div>
                  <div className={`font-mono text-2xl ${(scoreOf(d.row) ?? 0) >= 4 ? 'font-semibold text-signal' : ''}`}>
                    {scoreOf(d.row)?.toFixed(1) ?? '—'}<span className="text-sm text-muted-foreground">/5</span>
                  </div>
                </div>
                <div>
                  <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Stage · <span className="text-foreground">{d.row.Status === 'SKIP' ? 'Skipped' : d.row.Status}</span>
                  </div>
                  <StageRail status={d.row.Status} size="lg" />
                </div>
              </div>
            </SheetHeader>

            <StatusEditor num={d.row['#']} status={d.row.Status}
              onSaved={() => { setReloadKey(k => k + 1); onChanged() }} />
            <Section title="Notes"><p className="text-sm leading-relaxed">{d.row.Notes && d.row.Notes !== '—' ? d.row.Notes : <span className="text-muted-foreground">No notes yet.</span>}</p></Section>

            <Section title="Timeline">
              {d.timeline.length === 0
                ? <p className="text-sm text-muted-foreground">No recorded transitions yet.</p>
                : <ol className="space-y-1 text-sm">
                    {d.timeline.map((t, i) => (
                      <li key={i} className="flex gap-3">
                        <span className="w-24 shrink-0 font-mono text-xs leading-5 text-muted-foreground">{t.date}</span>
                        <span>{t.kind === 'due' ? '⏰ ' : t.kind === 'sent' ? '✉️ ' : ''}{t.detail}</span>
                      </li>
                    ))}
                  </ol>}
            </Section>

            <Section title="Documents">
              {d.documents.cv || d.documents.cover ? (
                <Tabs defaultValue={d.documents.cv ? 'cv' : 'cover'}>
                  <TabsList>
                    {d.documents.cv && <TabsTrigger value="cv">CV</TabsTrigger>}
                    {d.documents.cover && <TabsTrigger value="cover">Cover letter</TabsTrigger>}
                  </TabsList>
                  {(['cv', 'cover'] as const).map(k => d.documents[k] && (
                    <TabsContent key={k} value={k}>
                      <iframe title={k === 'cv' ? 'Tailored CV' : 'Cover letter'} src={d.documents[k]!} className="h-[70vh] w-full rounded-lg border" />
                    </TabsContent>
                  ))}
                </Tabs>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground">No tailored CV yet.</p>
                  {reportNum && <CopyPrompt text={`/career-ops pdf ${reportNum}`} />}
                </>
              )}
            </Section>

            <Section title="Contacts">
              {d.contacts.length === 0
                ? <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">No recruiter or hiring-manager contact recorded. Follow-ups go further with a named person — add one with <code className="font-mono text-foreground">/career-ops contacto</code>.</p>
                : <ul className="space-y-1 text-sm">
                    {d.contacts.map(c => (
                      <li key={c.name + c.company}>
                        <span className="font-medium">{c.name}</span> · {c.title || c.type}
                        {c.email && <> · <a className="underline" href={`mailto:${c.email}`}>{c.email}</a></>}
                        {c.linkedin && <> · <a className="underline" href={c.linkedin} target="_blank" rel="noreferrer">LinkedIn</a></>}
                      </li>
                    ))}
                  </ul>}
            </Section>

            {d.jd && (
              <Section title="Archived JD">
                <a className="text-sm underline" href={d.jd.url} target="_blank" rel="noreferrer">{d.jd.filename}</a>
              </Section>
            )}

            <Section title="Evaluation report">
              {!d.report
                ? <p className="text-sm text-muted-foreground">No report linked.</p>
                : splitReport(d.report).map((s, i) => (
                    <details key={s.title + i} open={i === 0} className="rounded-lg border bg-card p-3 open:shadow-sm">
                      <summary className="cursor-pointer text-sm font-medium">{s.title}</summary>
                      <div className="prose prose-sm mt-2 max-w-none text-sm"><Markdown>{s.body}</Markdown></div>
                    </details>
                  ))}
            </Section>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}
