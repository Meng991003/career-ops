// Scan foundit for DIRECT-APPLY roles only.
//   node scan-foundit-direct.mjs [--top 30] [--days 60]
//
// Why this exists: 12 of 13 roles from the 2026-08-31 batch could not be applied
// to. foundit mirrors listings from elsewhere, and a mirrored posting's Apply
// button just bounces you to the source — usually MyCareersFuture, whose apply
// needs Singpass (SG citizen/PR/pass holder only). Those are dead ends here.
//
// The search API returns `redirectUrl`: populated = mirrored elsewhere, empty =
// foundit-native Quick Apply. Filtering on it costs one API call per query
// instead of fetching every posting page, and it is the difference between a
// list of jobs and a list of jobs that can actually be submitted.
//
// Ranking is deliberately crude — title/skill overlap against portals.yml plus
// a salary-floor check. It is a sort order, not a fit score; the A-G evaluation
// is what judges fit.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import yaml from 'js-yaml';

const arg = (k, d) => {
  const i = process.argv.indexOf(k);
  return i > -1 ? process.argv[i + 1] : d;
};
const TOP = Number(arg('--top', 30));
const DAYS = Number(arg('--days', 60));
if (!Number.isInteger(TOP) || TOP < 1) throw new Error('--top must be a positive integer');

const portals = yaml.load(readFileSync('portals.yml', 'utf8'));
const tf = portals.title_filter || {};
const positive = (tf.positive || []).map((s) => s.toLowerCase());
const negative = (tf.negative || []).map((s) => s.toLowerCase());
const FLOOR = 6000; // SGD/month — MOM Employment Pass qualifying salary

// Queries: reuse whatever the foundit entries already search for.
const queries = [...new Set(
  (portals.tracked_companies || [])
    .filter((e) => e.provider === 'foundit' && e.searchKeywords)
    .map((e) => e.searchKeywords),
)];
if (!queries.length) throw new Error('no foundit searchKeywords in portals.yml');

const H = {
  Accept: '*/*',
  Referer: 'https://www.foundit.sg/srp/results',
  'X-Requested-With': 'XMLHttpRequest',
};
const cutoff = Date.now() - DAYS * 864e5;

// Skip anything already in the tracker. The re-run's rows carry no URL, so
// match on company+title text rather than job id — that is what is actually
// present on every row.
const norm = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ')
  .replace(/\b(pte|ltd|private|limited|inc|llc|the)\b/g, ' ').replace(/\s+/g, ' ').trim();
const known = new Set();
if (existsSync('data/applications.md')) {
  for (const l of readFileSync('data/applications.md', 'utf8').split('\n')) {
    if (!l.startsWith('|')) continue;
    const c = l.split('|').map((x) => x.trim());
    if (c.length > 5 && c[3] && c[4]) known.add(norm(c[3]) + '::' + norm(c[4]));
  }
}

const seen = new Map();
for (const q of queries) {
  for (let start = 0; start < 100; start += 50) {
    const url = `https://www.foundit.sg/middleware/jobsearch?start=${start}&limit=50`
      + `&query=${encodeURIComponent(q)}&locations=Singapore`;
    let data;
    try {
      const r = await fetch(url, { headers: H });
      data = (await r.json())?.jobSearchResponse?.data;
    } catch { break; }
    if (!Array.isArray(data) || !data.length) break;
    for (const j of data) {
      if (j.redirectUrl) continue;                 // mirrored elsewhere — unreachable
      if (!j.title || !j.jobId) continue;
      const posted = Date.parse(j.updatedAt || j.createdAt || '') || 0;
      if (posted && posted < cutoff) continue;
      if (known.has(norm(j.companyName) + '::' + norm(j.title))) continue;  // already tracked
      if (!seen.has(j.jobId)) seen.set(j.jobId, { ...j, query: q });
    }
  }
}

const lf = portals.location_filter || {};
const blocked = (lf.block || []).map((s) => s.toLowerCase());
const locationOk = (loc) => {
  const s = String(loc || '').toLowerCase();
  if (!s) return false;
  if (blocked.some((b) => s.includes(b))) return false;
  return s.includes('singapore');
};

const titleOk = (t) => {
  const s = t.toLowerCase();
  if (negative.some((n) => s.includes(n))) return false;
  return positive.some((p) => s.includes(p));
};

const rows = [];
for (const j of seen.values()) {
  if (!titleOk(j.title)) continue;
  if (!locationOk(j.locations)) continue;
  // Drop obvious non-monthly or junk salary data rather than ranking on it.
  if (j.maximumSalarySGDMonthlyFilter > 40000) continue;
  const min = j.minimumSalarySGDMonthlyFilter || 0;
  const max = j.maximumSalarySGDMonthlyFilter || 0;
  // `skills` comes back as a comma-delimited string, not an array.
  const skills = String(j.skills || '').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);
  const hits = positive.filter((p) => skills.some((s) => s.includes(p)) || j.title.toLowerCase().includes(p));
  let score = hits.length * 10;
  if (max && max >= FLOOR) score += 25;            // clears the EP floor
  else if (max) score -= 20;                        // advertised below the floor
  // minimumExperience/maximumExperience come back as {years: N}, not numbers.
  const exp = j.minimumExperience?.years ?? null;
  const maxExp = j.maximumExperience?.years ?? null;
  if (exp != null && exp <= 5) score += 15;         // within his 5y3m
  else if (exp != null && exp > 7) score -= 15;     // well above it
  rows.push({
    score, title: j.title, company: j.companyName || '(not named)',
    min, max, exp, maxExp,
    loc: String(j.locations || '').slice(0, 24),
    posted: String(j.updatedAt || j.createdAt || '').slice(0, 12),
    url: `https://www.foundit.sg/job/${j.jobId}`,
  });
}
rows.sort((a, b) => b.score - a.score);
const top = rows.slice(0, TOP);

const line = (r) => [
  r.company.slice(0, 24), r.title.slice(0, 46), r.loc,
  r.max ? `SGD ${r.min || '?'}-${r.max}` : 'not stated',
  r.exp != null ? `${r.exp}-${r.maxExp ?? '?'}y` : '-', r.posted, r.url,
].join('\t');

console.log(`direct-apply candidates: ${rows.length} (from ${seen.size} unmirrored postings, ${queries.length} queries)\n`);
console.log(['COMPANY', 'ROLE', 'LOCATION', 'SALARY', 'EXP', 'POSTED', 'URL'].join('\t'));
for (const r of top) console.log(line(r));

writeFileSync('output/foundit-direct-apply.tsv',
  ['company\trole\tlocation\tsalary\texp\tposted\turl', ...top.map(line)].join('\n') + '\n');
console.log(`\nwrote output/foundit-direct-apply.tsv (${top.length} rows)`);
