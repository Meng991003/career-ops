import { useEffect, useState } from 'react'
import Markdown from 'react-markdown'
import { getApplication, type Detail } from '@/lib/api'
import { splitReport } from '@/lib/report'
import { scoreOf } from '@/lib/rows'
import { StatusEditor } from '@/components/StatusEditor'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

function CopyPrompt({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2 rounded border p-2 text-sm">
      <code className="flex-1">{text}</code>
      <Button size="sm" variant="outline" onClick={() => navigator.clipboard.writeText(text)}>Copy</Button>
    </div>
  )
}

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="space-y-2"><h3 className="text-sm font-semibold">{title}</h3>{children}</section>
)

export function JobDrawer({ num, onClose, onChanged }: { num: string | null; onClose: () => void; onChanged: () => void }) {
  const [d, setD] = useState<Detail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    if (!num) return
    setD(null); setError(null)
    getApplication(num).then(setD, e => setError(e.message))
  }, [num, reloadKey])

  const reportNum = d?.row.Report?.match(/\[(\d+)\]/)?.[1]
  const url = d?.row.URL?.trim()

  return (
    <Sheet open={num !== null} onOpenChange={open => !open && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-3xl">
        {error && <p className="text-sm text-red-600">{error}</p>}
        {!d && !error && <p className="text-sm text-muted-foreground">Loading…</p>}
        {d && (
          <div className="space-y-6">
            <SheetHeader>
              <SheetTitle>{d.row.Company} — {d.row.Role}</SheetTitle>
              <SheetDescription className="flex flex-wrap items-center gap-2">
                <span>#{d.row['#']}</span>
                <span>score {scoreOf(d.row)?.toFixed(1) ?? '—'}</span>
                <Badge variant="secondary">{d.row.Status}</Badge>
                {url && /^https?:\/\//.test(url) && <a className="underline" href={url} target="_blank" rel="noreferrer">posting ↗</a>}
              </SheetDescription>
            </SheetHeader>

            <StatusEditor num={d.row['#']} status={d.row.Status}
              onSaved={() => { setReloadKey(k => k + 1); onChanged() }} />
            <p className="text-sm text-muted-foreground">Notes: {d.row.Notes || '—'}</p>

            <Section title="Timeline">
              {d.timeline.length === 0
                ? <p className="text-sm text-muted-foreground">No recorded transitions yet.</p>
                : <ol className="space-y-1 text-sm">
                    {d.timeline.map((t, i) => (
                      <li key={i} className="flex gap-3">
                        <span className="w-24 tabular-nums text-muted-foreground">{t.date}</span>
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
                      <iframe title={k} src={d.documents[k]!} className="h-[70vh] w-full rounded border" />
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
                ? <p className="text-sm text-amber-700">⚠ No recruiter or hiring-manager contact on record.</p>
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
                    <details key={s.title + i} open={i === 0} className="rounded border p-3">
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
