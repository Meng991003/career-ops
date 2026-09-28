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

export type FollowUp = { num: string; company: string; role: string; score: number | null; daysSinceApplication: number; daysOverdue: number; hasContact: boolean }
export type DigestJob = { title: string; company: string; url: string; location: string; salary: string | null; postedAt: string | null; applyRoute: string | null; triage: number; source: string }
export type RateCalibration = { band: string; ownPct: number; rangePct: [number, number]; typicalPct: number; source: string; caveat: string }
export type QuietInterview = { company: string; role: string; trackerNums: string[]; lastInterviewDate: string; daysSinceLastInterview: number }
export type Today = {
  followUps: { total: number; items: FollowUp[] }
  worthApplying: { total: number; items: { num: string; company: string; role: string; score: number }[] }
  digest: { date: string; total: number; items: DigestJob[] } | null
  quietInterviews: QuietInterview[]
  funnel: { everApplied: number; everResponded: number; everInterview: number; everOffer: number; responseRate: number; interviewRate: number; offerRate: number } | null
  calibration: { responseRate?: RateCalibration; interviewRate?: RateCalibration } | null
}
export type Hop = { from: string; to: string; n: number; median: number | null; p75: number | null; insufficientData: boolean }
export type StatsResponse = {
  stats: {
    tracker: { total: number; byStatus: Record<string, number>; avgScore: number | null; avgScoreApplied: number | null; topScore: number | null } | null
    funnel: Today['funnel']
    scan: { totalRecorded: number; distinctCompanies: number; firstSeen: string; lastSeen: string; addedPerWeek: { week: string; count: number }[]; byPortal: Record<string, number> } | null
  }
  velocity: { calibration: Today['calibration']; velocity: Record<string, Hop> | null }
}

export const getToday = () => call<Today>('/api/today')
export const getStats = () => call<StatsResponse>('/api/stats')
