import type { Row } from './rows'

export type TimelineItem = { date: string; kind: 'status' | 'due' | 'sent'; detail: string }
export type Contact = { name: string; company: string; type: string; title: string; email: string; linkedin: string; phone: string; notes: string }
export type Detail = {
  row: Row
  report: string | null
  timeline: TimelineItem[]
  documents: { cv: string | null; cover: string | null }
  contacts: Contact[]
  jd: { filename: string; url: string } | null
}
export type ListResponse = { rows: Row[]; appliedOn: Record<string, string> }

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init)
  const body = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(body.error ?? `${r.status} ${r.statusText}`)
  return body as T
}

export const getApplications = () => call<ListResponse>('/api/applications')
export const getApplication = (num: string) => call<Detail>(`/api/applications/${num}`)
export const patchApplication = (num: string, body: { status?: string; note?: string }) =>
  call<{ changed: boolean; newStatus: string }>(`/api/applications/${num}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
