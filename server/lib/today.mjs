// server/lib/today.mjs
// Pure pieces of GET /api/today. Inputs are script JSON / tracker rows; the
// route does the I/O. Row numbers are strings, like tracker # cells.

const scoreNum = s => { const m = /^(\d+(?:\.\d+)?)\/5/.exec(String(s ?? '').trim()); return m ? Number(m[1]) : null; };

export function followUpsDue(cadence, limit = 5) {
  const due = (cadence?.entries ?? []).filter(e => e.urgency === 'overdue' || e.urgency === 'urgent');
  const until = e => e.daysUntilNext ?? Infinity;
  due.sort((a, b) => (scoreNum(b.score) ?? 0) - (scoreNum(a.score) ?? 0) || until(a) - until(b));
  return {
    total: due.length,
    live: cadence?.metadata?.actionable ?? 0, // live applications the cadence tracks
    items: due.slice(0, limit).map(e => ({
      num: String(e.num), company: e.company, role: e.role, score: scoreNum(e.score),
      daysSinceApplication: e.daysSinceApplication, urgency: e.urgency, daysUntilNext: e.daysUntilNext ?? null,
      hasContact: (e.contacts ?? []).length > 0,
    })),
  };
}

export function worthApplying(rows, limit = 5) {
  const hits = rows
    .map(r => ({ num: r['#'], company: r.Company, role: r.Role, score: scoreNum(r.Score), status: r.Status }))
    .filter(r => r.status === 'Evaluated' && (r.score ?? 0) >= 4)
    .sort((a, b) => b.score - a.score)
    .map(({ status, ...r }) => r);
  return { total: hits.length, items: hits.slice(0, limit) };
}

export function latestDigestName(names) {
  return names.filter(n => /^digest-\d{4}-\d{2}-\d{2}\.json$/.test(n)).sort().at(-1) ?? null;
}

export function topDigestJobs(digest, limit = 5) {
  if (!digest) return null;
  const jobs = digest.sections
    .flatMap(s => s.jobs.map(j => ({ ...j, source: s.label })))
    .filter(j => j.applyRoute !== 'gated') // gated = Singpass-only, unapplicable
    .sort((a, b) => b.triage - a.triage);
  return { date: digest.date, total: jobs.length, items: jobs.slice(0, limit) };
}
