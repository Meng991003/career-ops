# Career-Ops UI v1 — M2 (Today, Board, Stats) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the three M2 screens to the React UI — a **Today** home screen of what needs the candidate now, an active-only **Board** (kanban) with drag-to-change-status, and a **Stats** page — plus the one data source Today lacks (a JSON twin of the nightly digest).

**Architecture:** Every Today/Stats number comes from an existing zero-token script's JSON (`followup-cadence.mjs`, `rejection-latency.mjs`, `stats.mjs`, `funnel-velocity.mjs`) or the tracker; the server aggregates them in two new GET routes with pure, tested helpers. `daily-digest.mjs` additionally writes `output/digest-{date}.json`. The UI gains hash routing (`#/today`, `#/applications`, `#/board`, `#/stats`) with no router dependency; the Board reuses the existing PATCH → `set-status.mjs` path and the existing job drawer.

**Tech Stack:** Node 26 (`.mjs`, plain `http`), React 19 + TypeScript + Tailwind 4 + shadcn@3 (ui/), Vitest, native HTML5 drag and drop, hand-built SVG/CSS bars (no chart library).

**Spec:** `docs/superpowers/specs/2026-09-28-career-ops-ui-v1-design.md` — §4.1 Today, §4.2 kanban, §4.6 Stats, §3.1 hard requirements.

## Global Constraints

- Files are the only database; no new persistence (spec U1). The only new file written is `output/digest-{date}.json`, by `daily-digest.mjs`.
- Every tracker write goes through `set-status.mjs` via the existing `PATCH /api/applications/:num` (spec U5). The Board adds no new write path.
- No AI triggers (spec U6). Anything needing judgement is a copy-prompt.
- The CSRF guard stays the first line of `handle()`; the new routes are GET-only.
- `ui/` dependencies stay in `ui/package.json`; add none — no router, no chart, no drag-and-drop library.
- Design system (already in `ui/src/index.css`): Overpass / Overpass Mono; tokens `--line` (blue accent), `--signal` (amber, **only** for fit ≥ 4.0), `--paper`, `--card`, `--rule`; light + dark via `.dark`. New chart-mark token `--mark`: `#2855D8` light, `#6588F7` dark (both validated by the dataviz validator against their card surfaces). Text never wears the mark colour.
- Charts: single series → one hue, no legend box, title names it; per-mark hover tooltip; a "Show as table" view; thin marks with 4px rounded ends; recessive axes. Status/band colours are not reused as series colours.
- Copy: sentence case, plain verbs, name things by what the user controls; empty states say what to do next.
- **git:** `/usr/bin/git` is broken (Xcode licence). Use `export PATH=/Applications/Xcode.app/Contents/Developer/usr/bin:$PATH`.
- Commit trailer, exactly: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Work only in the worktree `.claude/worktrees/feat-ui-m2` (branch `feat/ui-m2`). Its `data/`, `reports/`, `output/`, `jds/`, `cv.md`, profile, portals are copies — tests may read them; never commit them.
- Run server tests file by file or `npm run test:server`; UI tests `cd ui && npm test`; never `test-all.mjs`.
- Port 3700 may be occupied; use `CAREER_OPS_WEB_PORT=3701` for manual checks and never kill processes you did not start.

## Deliberately out of scope (M2)

- **Stale tailored CVs on Today** — spec §4.1 lists it, but its detection rule is an open question (spec §7) owned by M3/M4. Today ships without it.
- Interview rounds (no `data/active-interviews.md` in this install), user-saved filters, Machine Summary chips.

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `daily-digest.mjs` | Modify | Export `digestData()`; write `output/digest-{date}.json` beside the HTML |
| `daily-digest-tests.mjs` | Modify | Tests for `digestData` |
| `server/lib/today.mjs` | Create | Pure: `followUpsDue`, `worthApplying`, `latestDigestName`, `topDigestJobs` |
| `server/today-tests.mjs` | Create | Unit tests for today.mjs |
| `server/routes/insights.mjs` | Create | `GET /api/today`, `GET /api/stats` |
| `server/index.mjs` | Modify | Two routes |
| `server/insights-tests.mjs` | Create | Integration test (shape) against the running server |
| `ui/src/lib/route.ts` (+ `route.test.ts`) | Create | Hash route parse + `useRoute()` |
| `ui/src/lib/api.ts` | Modify | `getToday()`, `getStats()` + types |
| `ui/src/App.tsx` | Modify | Header nav, route switch, shared drawer |
| `ui/src/index.css` | Modify | `--mark` token |
| `ui/src/components/TodayPage.tsx` | Create | Today screen |
| `ui/src/components/BoardPage.tsx` | Create | Active-only kanban with drag and drop |
| `ui/src/lib/board.ts` (+ `board.test.ts`) | Create | Pure: group rows into board columns, drop decision |
| `ui/src/components/StatsPage.tsx` | Create | Stats screen |
| `ui/src/components/Bars.tsx` | Create | Accessible single-series bar chart with tooltip + table view |

---

### Task 1: Digest writes a JSON twin

**Files:**
- Modify: `daily-digest.mjs` (new export near `renderDigest`; one write in `main()`)
- Modify: `daily-digest-tests.mjs` (import + one section before the final summary)

**Interfaces:**
- Produces: `digestData({ sections, date })` → `{ date: string, sections: { label: string, jobs: { title, company, url, location, salary: string|null, postedAt: string|null, applyRoute: string|null, triage: number }[] }[] }`. File `output/digest-{date}.json` with that content. `applyRoute` values: `gated | likely-gated | open | unknown | null`.

- [ ] **Step 1: Failing test** — in `daily-digest-tests.mjs`, add `digestData` to the import list from `./daily-digest.mjs`, then insert before the final `console.log(\`\n${passed} passed…`:

```js
section('digestData — the JSON twin the web UI reads');
{
  const data = digestData({
    date: '2026-09-28',
    sections: [{
      label: 'JobStreet',
      jobs: [
        { title: 'Dev', company: 'Acme', url: 'https://x.test/1', location: 'Singapore',
          salary: { min: 120000, max: 120000 }, postedAt: '2026-09-01T08:00:00Z', applyRoute: 'open', score: 7 },
        { title: 'Ops', url: 'https://x.test/2', score: 3 },
      ],
    }],
  });
  assert(data.date === '2026-09-28', 'carries the digest date');
  const [a, b] = data.sections[0].jobs;
  assert(data.sections[0].label === 'JobStreet', 'keeps the section label');
  assert(a.triage === 7 && a.applyRoute === 'open', 'keeps triage rank and apply route');
  assert(a.salary !== null && a.salary.includes('10,000'), 'salary is the same monthly text the page shows');
  assert(a.postedAt === '2026-09-01', 'postedAt is a plain date');
  assert(b.company === '' && b.salary === null && b.postedAt === null && b.applyRoute === null,
    'missing fields become empty/null, never undefined');
  assert(JSON.stringify(data) === JSON.stringify(JSON.parse(JSON.stringify(data))), 'is plain JSON');
}
```

- [ ] **Step 2: Run — expect failure:** `node daily-digest-tests.mjs` → SyntaxError / `digestData` is not exported.

- [ ] **Step 3: Implement** — in `daily-digest.mjs`, directly above `export function renderDigest(`:

```js
/**
 * Machine-readable twin of the rendered digest, read by the web UI's Today
 * screen (server/lib/today.mjs). Same sections, same rows, same order — only
 * the fields the UI shows. Written next to the HTML so neither drifts.
 */
export function digestData({ sections, date }) {
  return {
    date,
    sections: sections.map(({ label, jobs }) => ({
      label,
      jobs: jobs.map(j => ({
        title: j.title ?? '',
        company: j.company ?? '',
        url: j.url ?? '',
        location: j.location ?? '',
        salary: salaryText(j.salary),
        postedAt: j.postedAt ? new Date(j.postedAt).toISOString().slice(0, 10) : null,
        applyRoute: j.applyRoute ?? null,
        triage: j.score,
      })),
    })),
  };
}
```

(`salaryText` is a function declaration later in the file, so it is hoisted; it returns `null` for a missing salary.)

In `main()`, directly after `writeFileSync(outPath, html, 'utf-8');`:

```js
  const jsonPath = join(OUTPUT_DIR, `digest-${date}.json`);
  writeFileSync(jsonPath, JSON.stringify(digestData({ sections, date }), null, 2) + '\n', 'utf-8');
```

and after `console.log(\`Digest written: ${outPath}\`);` add `console.log(\`  data: ${jsonPath}\`);`.

- [ ] **Step 4: Run:** `node daily-digest-tests.mjs` → `181 passed, 0 failed` (174 + 7 new). Do **not** run `node daily-digest.mjs` (it fetches live job sites).

- [ ] **Step 5: Commit**

```bash
git add daily-digest.mjs daily-digest-tests.mjs
git commit -m "feat(digest): write a JSON twin of the digest for the web UI

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Server — `GET /api/today` and `GET /api/stats`

**Files:**
- Create: `server/lib/today.mjs`, `server/today-tests.mjs`, `server/routes/insights.mjs`, `server/insights-tests.mjs`
- Modify: `server/index.mjs` (import + two ROUTES entries)

**Interfaces:**
- Consumes: `runScriptJson(script, args)` from `server/lib/run.mjs` (throws on non-zero exit); `parseTable` from `server/lib/markdown-table.mjs`; `resolveTrackerPath`, `getCareerOpsRoot` from `../../path-resolver.mjs`; `REPO_ROOT` from `server/lib/paths.mjs`.
- Script facts: `followup-cadence.mjs` → `{ metadata, entries: [{ num, company, role, score: "3.7/5", urgency: "overdue"|"urgent"|"waiting"|…, daysSinceApplication, daysUntilNext, contacts: [] }] }`. `rejection-latency.mjs` → `{ flags: [{ company, role, trackerNums: [], lastInterviewDate, daysSinceLastInterview }] }`. `stats.mjs` → `{ tracker, funnel: { everApplied, everResponded, everInterview, everOffer, responseRate, interviewRate, offerRate }, scan: { addedPerWeek: [{week,count}], byPortal: {name: n}, distinctCompanies, firstSeen, lastSeen }, … }`. `funnel-velocity.mjs` → `{ calibration: { responseRate: { band, ownPct, rangePct:[lo,hi], typicalPct, source, caveat }, interviewRate: {…} }, velocity: { appliedToResponded: { n, median, p75, insufficientData }, … } }`.
- Produces:
  - `followUpsDue(cadence, limit=5)` → `{ total, items: [{ num: string, company, role, score: number|null, daysSinceApplication, daysOverdue, hasContact }] }` — urgency `overdue` or `urgent`, highest score first, then most overdue.
  - `worthApplying(rows, limit=5)` → `{ total, items: [{ num, company, role, score }] }` — Status `Evaluated`, score ≥ 4.0, highest first.
  - `latestDigestName(names)` → newest `digest-YYYY-MM-DD.json` name or `null`.
  - `topDigestJobs(digest, limit=5)` → `{ date, total, items: [{ ...job, source }] }` — every section flattened, `applyRoute === 'gated'` excluded, highest `triage` first. `null` digest → `null`.
  - `GET /api/today` → `{ followUps, worthApplying, digest: {date,total,items}|null, quietInterviews: flags[], funnel: stats.funnel, calibration: fv.calibration }`.
  - `GET /api/stats` → `{ stats, velocity: fv }` (both scripts' JSON verbatim).

- [ ] **Step 1: Failing unit tests** — `server/today-tests.mjs`

```js
// server/today-tests.mjs
import { followUpsDue, worthApplying, latestDigestName, topDigestJobs } from './lib/today.mjs';

let passed = 0, failed = 0;
const ok = (c, m) => { if (c) { console.log(`PASS ${m}`); passed++; } else { console.error(`FAIL ${m}`); failed++; } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m);

const cadence = { entries: [
  { num: 1, company: 'A', role: 'r', score: '3.7/5', urgency: 'overdue', daysSinceApplication: 38, daysUntilNext: -31, contacts: [] },
  { num: 2, company: 'B', role: 'r', score: '4.2/5', urgency: 'overdue', daysSinceApplication: 20, daysUntilNext: -5, contacts: [{}] },
  { num: 3, company: 'C', role: 'r', score: '3.7/5', urgency: 'urgent', daysSinceApplication: 9, daysUntilNext: -40, contacts: [] },
  { num: 4, company: 'D', role: 'r', score: '4.9/5', urgency: 'waiting', daysSinceApplication: 2, daysUntilNext: 5, contacts: [] },
] };
const fu = followUpsDue(cadence, 2);
eq(fu.total, 3, 'followUpsDue counts overdue + urgent, not waiting');
eq(fu.items.map(i => i.num), ['2', '3'], 'highest score first, then most overdue');
eq(fu.items[0].hasContact, true, 'hasContact reflects the contacts array');
eq(fu.items[1].daysOverdue, 40, 'daysOverdue is the positive days past due');
eq(followUpsDue(null).total, 0, 'missing cadence → empty');

const rows = [
  { '#': '10', Company: 'X', Role: 'r', Score: '4.5/5', Status: 'Evaluated' },
  { '#': '11', Company: 'Y', Role: 'r', Score: '4.0/5', Status: 'Evaluated' },
  { '#': '12', Company: 'Z', Role: 'r', Score: '4.8/5', Status: 'Applied' },
  { '#': '13', Company: 'W', Role: 'r', Score: '3.9/5', Status: 'Evaluated' },
];
const wa = worthApplying(rows);
eq(wa.items.map(i => i.num), ['10', '11'], 'worthApplying: Evaluated and ≥ 4.0 only, best first');
eq(wa.items[0].score, 4.5, 'score is a number');

eq(latestDigestName(['digest-2026-09-25.json', 'digest-2026-09-28.html', 'digest-2026-09-27.json', 'x.json']),
  'digest-2026-09-27.json', 'latestDigestName picks the newest .json, ignores html');
eq(latestDigestName([]), null, 'no digest → null');

const digest = { date: '2026-09-28', sections: [
  { label: 'JobStreet', jobs: [{ title: 'a', triage: 5, applyRoute: 'open' }, { title: 'b', triage: 9, applyRoute: 'gated' }] },
  { label: 'foundit', jobs: [{ title: 'c', triage: 7, applyRoute: 'likely-gated' }] },
] };
const td = topDigestJobs(digest, 5);
eq(td.items.map(j => j.title), ['c', 'a'], 'topDigestJobs: gated excluded, best triage first');
eq(td.items[0].source, 'foundit', 'each job carries its section label as source');
eq([td.total, td.date], [2, '2026-09-28'], 'total counts the non-gated jobs; date carried');
eq(topDigestJobs(null), null, 'no digest → null');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
```

- [ ] **Step 2: Run — expect ERR_MODULE_NOT_FOUND:** `node server/today-tests.mjs`

- [ ] **Step 3: Implement** — `server/lib/today.mjs`

```js
// server/lib/today.mjs
// Pure pieces of GET /api/today. Inputs are script JSON / tracker rows; the
// route does the I/O. Row numbers are strings, like tracker # cells.

const scoreNum = s => { const m = /^(\d+(?:\.\d+)?)\/5/.exec(String(s ?? '').trim()); return m ? Number(m[1]) : null; };

export function followUpsDue(cadence, limit = 5) {
  const due = (cadence?.entries ?? []).filter(e => e.urgency === 'overdue' || e.urgency === 'urgent');
  due.sort((a, b) => (scoreNum(b.score) ?? 0) - (scoreNum(a.score) ?? 0) || a.daysUntilNext - b.daysUntilNext);
  return {
    total: due.length,
    items: due.slice(0, limit).map(e => ({
      num: String(e.num), company: e.company, role: e.role, score: scoreNum(e.score),
      daysSinceApplication: e.daysSinceApplication, daysOverdue: Math.max(0, -e.daysUntilNext),
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
```

- [ ] **Step 4: Run:** `node server/today-tests.mjs` → `13 passed, 0 failed`.

- [ ] **Step 5: Routes** — `server/routes/insights.mjs`

```js
// server/routes/insights.mjs
// Read-only aggregations for the Today and Stats screens. Every number comes
// from an existing zero-token script; this file only gathers and trims.
import { readFile, readdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { sendJson } from '../lib/http.mjs';
import { runScriptJson } from '../lib/run.mjs';
import { REPO_ROOT } from '../lib/paths.mjs';
import { parseTable } from '../lib/markdown-table.mjs';
import { resolveTrackerPath, getCareerOpsRoot } from '../../path-resolver.mjs';
import { followUpsDue, worthApplying, latestDigestName, topDigestJobs } from '../lib/today.mjs';

async function latestDigest() {
  const dir = join(REPO_ROOT, 'output');
  if (!existsSync(dir)) return null;
  const name = latestDigestName(await readdir(dir));
  if (!name) return null;
  try { return JSON.parse(await readFile(join(dir, name), 'utf-8')); } catch { return null; }
}

async function trackerRows() {
  const abs = resolveTrackerPath(getCareerOpsRoot());
  return existsSync(abs) ? parseTable(await readFile(abs, 'utf-8')).rows : [];
}

export async function today(req, res) {
  const [cadence, latency, stats, fv, rows, digest] = await Promise.all([
    runScriptJson('followup-cadence.mjs'),
    runScriptJson('rejection-latency.mjs'),
    runScriptJson('stats.mjs'),
    runScriptJson('funnel-velocity.mjs'),
    trackerRows(),
    latestDigest(),
  ]);
  sendJson(res, 200, {
    followUps: followUpsDue(cadence),
    worthApplying: worthApplying(rows),
    digest: topDigestJobs(digest),
    quietInterviews: latency.flags ?? [],
    funnel: stats.funnel,
    calibration: fv.calibration,
  });
}

export async function stats(req, res) {
  const [s, fv] = await Promise.all([runScriptJson('stats.mjs'), runScriptJson('funnel-velocity.mjs')]);
  sendJson(res, 200, { stats: s, velocity: fv });
}
```

`server/index.mjs`: `import * as insights from './routes/insights.mjs';` and add to `ROUTES`:

```js
  ['GET',   /^\/api\/today$/,                 insights.today],
  ['GET',   /^\/api\/stats$/,                 insights.stats],
```

- [ ] **Step 6: Integration test** — `server/insights-tests.mjs` (shape only; runs against the worktree's data copies)

```js
// server/insights-tests.mjs
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
let passed = 0, failed = 0;
const ok = (c, m) => { if (c) { console.log(`PASS ${m}`); passed++; } else { console.error(`FAIL ${m}`); failed++; } };
const PORT = 3797, base = `http://127.0.0.1:${PORT}`;
const srv = spawn(process.execPath, [join(HERE, 'index.mjs')], { env: { ...process.env, CAREER_OPS_WEB_PORT: String(PORT) }, stdio: 'ignore' });
async function up() { for (let i = 0; i < 200; i++) { try { if ((await fetch(`${base}/api/applications`)).ok) return; } catch {} await new Promise(r => setTimeout(r, 50)); } throw new Error('server did not start'); }
try {
  await up();
  const t = await fetch(`${base}/api/today`);
  const tb = await t.json();
  ok(t.status === 200, 'GET /api/today → 200');
  ok(typeof tb.followUps?.total === 'number' && Array.isArray(tb.followUps.items), 'today.followUps {total, items}');
  ok(Array.isArray(tb.worthApplying?.items), 'today.worthApplying.items');
  ok(tb.digest === null || Array.isArray(tb.digest.items), 'today.digest is null or {items}');
  ok(Array.isArray(tb.quietInterviews), 'today.quietInterviews[]');
  ok(typeof tb.funnel?.everApplied === 'number', 'today.funnel from stats.mjs');
  ok(typeof tb.calibration?.responseRate === 'object', 'today.calibration from funnel-velocity.mjs');
  const s = await fetch(`${base}/api/stats`);
  const sb = await s.json();
  ok(s.status === 200 && Array.isArray(sb.stats?.scan?.addedPerWeek) && typeof sb.velocity?.velocity === 'object', 'GET /api/stats → {stats, velocity}');
  ok((await fetch(`${base}/api/today`, { method: 'POST', headers: { origin: base } })).status === 404, 'today is GET-only');
} finally { srv.kill(); }
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
```

- [ ] **Step 7: Run:** `node server/today-tests.mjs && node server/insights-tests.mjs && npm run test:server` → all pass.

- [ ] **Step 8: Commit**

```bash
git add server/lib/today.mjs server/today-tests.mjs server/routes/insights.mjs server/insights-tests.mjs server/index.mjs
git commit -m "feat(server): GET /api/today and /api/stats from the existing zero-token scripts

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Hash routing, header nav, `--mark` token, API client

**Files:**
- Create: `ui/src/lib/route.ts`, `ui/src/lib/route.test.ts`
- Modify: `ui/src/App.tsx`, `ui/src/lib/api.ts`, `ui/src/index.css`

**Interfaces:**
- Produces: `type Route = 'today' | 'applications' | 'board' | 'stats'`; `ROUTES: { id: Route; label: string }[]`; `parseRoute(hash: string): Route` (unknown/empty → `'today'`); `useRoute(): Route` (re-renders on `hashchange`).
- Produces (api.ts): `getToday(): Promise<Today>`, `getStats(): Promise<StatsResponse>` and the exported types below.
- Produces (App): each page receives `onOpen(num: string)`; the single `<JobDrawer>` lives in App; `refreshKey` bumps after a drawer save and is passed to every page.

- [ ] **Step 1: Failing test** — `ui/src/lib/route.test.ts`

```ts
import { expect, it } from 'vitest'
import { parseRoute } from './route'

it('maps hashes to routes and defaults to today', () => {
  expect(parseRoute('#/board')).toBe('board')
  expect(parseRoute('#/stats')).toBe('stats')
  expect(parseRoute('#/applications')).toBe('applications')
  expect(parseRoute('')).toBe('today')
  expect(parseRoute('#/nope')).toBe('today')
})
```

- [ ] **Step 2: Run — expect failure:** `cd ui && npm test`

- [ ] **Step 3: Implement** — `ui/src/lib/route.ts`

```ts
import { useEffect, useState } from 'react'

// Hash routes: no router dependency for four screens, and the server needs no
// SPA fallback because every URL is `/`.
export type Route = 'today' | 'applications' | 'board' | 'stats'
export const ROUTES: { id: Route; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'applications', label: 'Applications' },
  { id: 'board', label: 'Board' },
  { id: 'stats', label: 'Stats' },
]

export function parseRoute(hash: string): Route {
  const id = hash.replace(/^#\/?/, '')
  return ROUTES.some(r => r.id === id) ? (id as Route) : 'today'
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(location.hash))
  useEffect(() => {
    const on = () => setRoute(parseRoute(location.hash))
    addEventListener('hashchange', on)
    return () => removeEventListener('hashchange', on)
  }, [])
  return route
}
```

- [ ] **Step 4: Types + client** — append to `ui/src/lib/api.ts`:

```ts
export type FollowUp = { num: string; company: string; role: string; score: number | null; daysSinceApplication: number; daysOverdue: number; hasContact: boolean }
export type DigestJob = { title: string; company: string; url: string; location: string; salary: string | null; postedAt: string | null; applyRoute: string | null; triage: number; source: string }
export type RateCalibration = { band: string; ownPct: number; rangePct: [number, number]; typicalPct: number; source: string; caveat: string }
export type QuietInterview = { company: string; role: string; trackerNums: string[]; lastInterviewDate: string; daysSinceLastInterview: number }
export type Today = {
  followUps: { total: number; items: FollowUp[] }
  worthApplying: { total: number; items: { num: string; company: string; role: string; score: number }[] }
  digest: { date: string; total: number; items: DigestJob[] } | null
  quietInterviews: QuietInterview[]
  funnel: { everApplied: number; everResponded: number; everInterview: number; everOffer: number; responseRate: number; interviewRate: number; offerRate: number }
  calibration: { responseRate?: RateCalibration; interviewRate?: RateCalibration }
}
export type Hop = { from: string; to: string; n: number; median: number | null; p75: number | null; insufficientData: boolean }
export type StatsResponse = {
  stats: {
    tracker: { total: number; byStatus: Record<string, number>; avgScore: number; avgScoreApplied: number; topScore: number }
    funnel: Today['funnel']
    scan: { totalRecorded: number; distinctCompanies: number; firstSeen: string; lastSeen: string; addedPerWeek: { week: string; count: number }[]; byPortal: Record<string, number> }
  }
  velocity: { calibration: Today['calibration']; velocity: Record<string, Hop> }
}

export const getToday = () => call<Today>('/api/today')
export const getStats = () => call<StatsResponse>('/api/stats')
```

- [ ] **Step 5: `--mark` token** — in `ui/src/index.css`: inside `@theme inline { … }` add `--color-mark: var(--mark);`; in `:root` add `--mark: #2855D8;` (next to `--line`); in `.dark` add `--mark: #6588F7;`.

- [ ] **Step 6: App shell** — replace `ui/src/App.tsx` with:

```tsx
import { useState } from 'react'
import { ApplicationsTable } from '@/components/ApplicationsTable'
import { BoardPage } from '@/components/BoardPage'
import { JobDrawer } from '@/components/JobDrawer'
import { StatsPage } from '@/components/StatsPage'
import { ThemeToggle } from '@/components/ThemeToggle'
import { TodayPage } from '@/components/TodayPage'
import { ROUTES, useRoute } from '@/lib/route'

const TITLES = {
  today: 'What needs you today',
  applications: 'Where every application stands',
  board: 'Live applications',
  stats: 'How the search is going',
} as const

export default function App() {
  const route = useRoute()
  const [openNum, setOpenNum] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const page = { onOpen: setOpenNum, refreshKey }
  return (
    <div className="min-h-screen">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-2.5 gap-y-2 px-4 py-3 sm:px-6">
          <span aria-hidden className="size-2.5 rounded-full bg-line ring-4 ring-line/15" />
          <span className="mr-3 text-sm font-extrabold tracking-tight">Career-Ops</span>
          <nav aria-label="Screens" className="order-last flex w-full gap-1 sm:order-none sm:w-auto">
            {ROUTES.map(r => (
              <a key={r.id} href={`#/${r.id}`} aria-current={route === r.id ? 'page' : undefined}
                className={`rounded-full px-3 py-1 text-sm transition-colors ${route === r.id ? 'bg-accent font-semibold text-line' : 'text-muted-foreground hover:text-foreground'}`}>
                {r.label}
              </a>
            ))}
          </nav>
          <a href="/legacy" className="ml-auto mr-2 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">Setup (old UI)</a>
          <ThemeToggle />
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
        <h1 className="mb-5 text-3xl font-extrabold tracking-tight sm:text-4xl">{TITLES[route]}</h1>
        {route === 'today' && <TodayPage {...page} />}
        {route === 'applications' && <ApplicationsTable {...page} />}
        {route === 'board' && <BoardPage {...page} />}
        {route === 'stats' && <StatsPage />}
        <JobDrawer num={openNum} onClose={() => setOpenNum(null)} onChanged={() => setRefreshKey(k => k + 1)} />
      </main>
    </div>
  )
}
```

So this task builds on its own, create **placeholder** pages (replaced in Tasks 4–6):
`ui/src/components/TodayPage.tsx`: `export function TodayPage(_: { onOpen: (num: string) => void; refreshKey: number }) { return <p className="text-sm text-muted-foreground">Today is coming in the next task.</p> }` — and the same shape for `BoardPage.tsx` (same props) and `StatsPage.tsx` (no props). If `noUnusedParameters` rejects `_`, destructure nothing: `export function TodayPage(props: …) { void props; return … }`.

- [ ] **Step 7: Verify:** `cd ui && npm test && npm run build` pass. With a server on 3701 (`CAREER_OPS_WEB_PORT=3701 node server/index.mjs &` from the worktree root, after `npm run ui:build`), open `http://127.0.0.1:3701/` → Today placeholder; nav switches screens; `#/applications` shows the existing list; back/forward work. Kill the server.

- [ ] **Step 8: Commit**

```bash
git add ui/src/lib/route.ts ui/src/lib/route.test.ts ui/src/lib/api.ts ui/src/App.tsx ui/src/index.css ui/src/components/TodayPage.tsx ui/src/components/BoardPage.tsx ui/src/components/StatsPage.tsx
git commit -m "feat(ui): hash routing and header nav for Today / Applications / Board / Stats

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Today screen

**Files:**
- Replace: `ui/src/components/TodayPage.tsx`

**Interfaces:**
- Consumes: `getToday()` / `Today` types (Task 3); `onOpen(num)` opens the drawer; `refreshKey` refetches.
- Layout (top to bottom): a **funnel strip** (applied → responded → interviewing, with the response rate against the benchmark range); then cards in a responsive 2-column grid (1 column below `md`): **Follow-ups due**, **Worth applying**, **From last night's digest**, and **Interviews gone quiet** (rendered only when non-empty).

- [ ] **Step 1: Implement** — `ui/src/components/TodayPage.tsx`

```tsx
import { useEffect, useState } from 'react'
import { getToday, type Today } from '@/lib/api'
import { Button } from '@/components/ui/button'

const ROUTE_LABEL: Record<string, string> = { open: 'Open to apply', 'likely-gated': 'Check apply button', unknown: 'Route unknown' }

function Card({ title, count, children, footer }: { title: string; count?: number; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <section className="flex flex-col rounded-xl border bg-card">
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

function Funnel({ t }: { t: Today }) {
  const f = t.funnel, rr = t.calibration.responseRate
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
      <Funnel t={t} />
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
```

- [ ] **Step 2: Verify** — `cd ui && npm run build` passes; with a worktree server on 3701 open `#/today`: funnel shows Applied 133 / Responded 1 / Interviewed 1 / Offers 0 and the reply-rate sentence; Follow-ups due shows 127 with 5 rows; clicking a row opens the drawer; Worth applying shows the 5 roles ≥ 4.0; the digest card shows the "No digest data yet" empty state (no JSON exists until tonight's run — to see the populated state, write a hand-made `output/digest-2026-09-28.json` in the worktree matching Task 1's shape, check, then delete it). Check dark mode and a 375px width.

- [ ] **Step 3: Commit**

```bash
git add ui/src/components/TodayPage.tsx
git commit -m "feat(ui): Today screen — funnel, follow-ups due, worth applying, digest, quiet interviews

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Board (active-only kanban)

**Files:**
- Create: `ui/src/lib/board.ts`, `ui/src/lib/board.test.ts`
- Replace: `ui/src/components/BoardPage.tsx`

**Interfaces:**
- Consumes: `getApplications()` → `{ rows, appliedOn }`; `patchApplication(num, { status })` (throws with the server's message); `scoreOf`, `viaOf` from `rows.ts`; `toast` from `sonner`.
- Produces (`board.ts`): `BOARD = ['Applied', 'Responded', 'Interview', 'Offer', 'Hired']`; `columns(rows, appliedOn): Record<string, Row[]>` — only board statuses; each column sorted by applied date (from `appliedOn`, else `Date`) oldest first, so the longest-waiting card is on top; `dropMove(from: string, to: string): string | null` — returns the target status when it differs and is a board column, else `null`.

- [ ] **Step 1: Failing tests** — `ui/src/lib/board.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { BOARD, columns, dropMove } from './board'

const r = (num: string, Status: string, Date = '2026-09-01') => ({ '#': num, Status, Date, Company: 'c', Role: 'r', Score: '3.0/5' })

describe('columns', () => {
  it('keeps only board statuses, oldest applied first, preferring the status-log date', () => {
    const cols = columns([r('1', 'Applied', '2026-09-10'), r('2', 'Applied', '2026-09-01'), r('3', 'Evaluated'), r('4', 'Interview')], { '1': '2026-08-20' })
    expect(Object.keys(cols)).toEqual(BOARD)
    expect(cols.Applied.map(x => x['#'])).toEqual(['1', '2'])
    expect(cols.Interview.map(x => x['#'])).toEqual(['4'])
    expect(cols.Hired).toEqual([])
  })
})

describe('dropMove', () => {
  it('moves only between different board columns', () => {
    expect(dropMove('Applied', 'Interview')).toBe('Interview')
    expect(dropMove('Applied', 'Applied')).toBeNull()
    expect(dropMove('Applied', 'Rejected')).toBeNull()
  })
})
```

- [ ] **Step 2: Run — expect failure:** `cd ui && npm test`

- [ ] **Step 3: Implement** — `ui/src/lib/board.ts`

```ts
import type { Row } from './rows'

// Only live applications: the stations after Evaluated. Evaluated (the inbox)
// and the off-line statuses stay in the Applications list.
export const BOARD = ['Applied', 'Responded', 'Interview', 'Offer', 'Hired']

export function columns(rows: Row[], appliedOn: Record<string, string>): Record<string, Row[]> {
  const when = (r: Row) => appliedOn[r['#']] ?? r.Date ?? ''
  const out: Record<string, Row[]> = Object.fromEntries(BOARD.map(s => [s, [] as Row[]]))
  for (const r of rows) if (out[r.Status]) out[r.Status].push(r)
  for (const s of BOARD) out[s].sort((a, b) => when(a).localeCompare(when(b)))
  return out
}

export function dropMove(from: string, to: string): string | null {
  return from !== to && BOARD.includes(to) ? to : null
}
```

- [ ] **Step 4: Run:** `cd ui && npm test` → pass.

- [ ] **Step 5: Page** — `ui/src/components/BoardPage.tsx`

```tsx
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { getApplications, patchApplication, type ListResponse } from '@/lib/api'
import { BOARD, columns, dropMove } from '@/lib/board'
import { scoreOf, viaOf } from '@/lib/rows'

// Drag a card to another column to change its status (via set-status.mjs).
// Keyboard and touch users change status in the drawer — every card opens it.
export function BoardPage({ onOpen, refreshKey }: { onOpen: (num: string) => void; refreshKey: number }) {
  const [data, setData] = useState<ListResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [over, setOver] = useState<string | null>(null)
  const [reload, setReload] = useState(0)
  useEffect(() => { getApplications().then(setData, e => setError(e.message)) }, [refreshKey, reload])
  const cols = useMemo(() => (data ? columns(data.rows, data.appliedOn) : null), [data])

  if (error) return <p className="rounded-lg border border-destructive/30 bg-card p-4 text-sm text-destructive">Couldn't read the tracker: {error}</p>
  if (!cols) return <p className="text-sm text-muted-foreground">Loading…</p>

  async function drop(num: string, from: string, to: string) {
    setOver(null)
    const target = dropMove(from, to)
    if (!target) return
    try {
      await patchApplication(num, { status: target })
      toast.success(`#${num} → ${target}`)
      setReload(k => k + 1)
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  return (
    <>
      <p className="mb-4 text-sm text-muted-foreground">Drag a card to move it along. Open a card to change its status from the keyboard.</p>
      <div className="-mx-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
        <div className="grid min-w-[56rem] grid-cols-5 gap-3">
          {BOARD.map(s => (
            <section key={s} aria-label={`${s} column`}
              onDragOver={e => { e.preventDefault(); setOver(s) }}
              onDragLeave={() => setOver(o => (o === s ? null : o))}
              onDrop={e => { const [num, from] = e.dataTransfer.getData('text/plain').split('|'); drop(num, from, s) }}
              className={`flex max-h-[70vh] flex-col rounded-xl border bg-muted/40 transition-colors ${over === s ? 'border-line bg-accent' : ''}`}>
              <header className="flex items-baseline justify-between px-3 py-2.5">
                <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{s}</h2>
                <span className="font-mono text-sm text-muted-foreground">{cols[s].length}</span>
              </header>
              <ul className="flex-1 space-y-2 overflow-y-auto px-2 pb-2">
                {cols[s].length === 0 && <li className="rounded-lg border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">Drop here</li>}
                {cols[s].map(r => {
                  const score = scoreOf(r)
                  return (
                    <li key={r['#']}>
                      <button type="button" draggable onClick={() => onOpen(r['#'])}
                        onDragStart={e => { e.dataTransfer.setData('text/plain', `${r['#']}|${r.Status}`); e.dataTransfer.effectAllowed = 'move' }}
                        className="w-full cursor-grab rounded-lg border bg-card px-3 py-2 text-left shadow-xs transition-colors hover:border-line/50 active:cursor-grabbing">
                        <span className="flex items-baseline justify-between gap-2">
                          <span className="truncate text-sm font-semibold">{r.Company === '?' ? 'Undisclosed' : r.Company}</span>
                          <span className={`font-mono text-xs ${score !== null && score >= 4 ? 'font-semibold text-signal' : 'text-muted-foreground'}`}>{score?.toFixed(1) ?? '—'}</span>
                        </span>
                        <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">{r.Role}</span>
                        <span className="mt-1 block font-mono text-[11px] text-muted-foreground">
                          #{r['#']} · {data!.appliedOn[r['#']] ?? r.Date}{viaOf(r) ? ` · via ${viaOf(r)}` : ''}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </>
  )
}
```

- [ ] **Step 6: Verify against a throwaway tracker** (never the worktree's `data/applications.md`):

```bash
cp data/applications.md "$TMPDIR/apps-board.md"
CAREER_OPS_TRACKER="$TMPDIR/apps-board.md" CAREER_OPS_WEB_PORT=3701 node server/index.mjs &
```

Open `http://127.0.0.1:3701/#/board`: 5 columns, Applied 130 / Interview 1; drag an Applied card to Responded → success toast, card moves, `tail -1 "$TMPDIR/status-log.tsv"` shows `…\tApplied\tResponded\tweb\t`; drop on its own column → nothing happens; clicking a card opens the drawer. Stop the server; `rm "$TMPDIR/apps-board.md" "$TMPDIR/status-log.tsv"`. (If the browser automation cannot perform HTML5 drag and drop, verify the PATCH with curl and say so.)

- [ ] **Step 7: Commit**

```bash
git add ui/src/lib/board.ts ui/src/lib/board.test.ts ui/src/components/BoardPage.tsx
git commit -m "feat(ui): Board — live applications by stage, drag a card to change its status

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Stats screen

**Files:**
- Create: `ui/src/components/Bars.tsx`
- Replace: `ui/src/components/StatsPage.tsx`

**Interfaces:**
- Consumes: `getStats()` → `StatsResponse` (Task 3); `--color-mark` (`bg-mark` / `fill-mark`) token (Task 3).
- Produces: `<Bars title data={[{ label, value }]} orientation="vertical"|"horizontal" format? />` — single-series bar chart: title names the series (no legend), `bg-mark` bars with 4px rounded data-ends anchored to the baseline, 2px gap between bars, per-bar hover/focus tooltip (label + value), bars are focusable (`tabIndex=0`, `aria-label`), and a `<details>` "Show as table" view. Text uses text tokens, never the mark colour.
- Page sections: **Funnel** (stat tiles: applied / responded / interviewed / offers, plus the response- and interview-rate vs benchmark range, with source + caveat as small print); **Time between stages** (from `velocity.velocity`: each hop's median days, or "Not enough data yet (n=…)" when `insufficientData`); **Pipeline** (horizontal bars of `tracker.byStatus` in pipeline order); **Scanning** (vertical bars of `scan.addedPerWeek`; horizontal bars of `scan.byPortal` sorted desc; totals line: `{totalRecorded}` postings from `{distinctCompanies}` companies since `{firstSeen}`).

- [ ] **Step 1: Chart component** — `ui/src/components/Bars.tsx`

```tsx
import { useState } from 'react'

type Datum = { label: string; value: number }

// Single-series bars. One hue (--mark), no legend (the title names the series),
// per-bar tooltip on hover and keyboard focus, and a table view for exact values.
export function Bars({ title, data, orientation = 'horizontal', format = (n: number) => n.toLocaleString() }: {
  title: string; data: Datum[]; orientation?: 'horizontal' | 'vertical'; format?: (n: number) => string
}) {
  const [hot, setHot] = useState<number | null>(null)
  const max = Math.max(1, ...data.map(d => d.value))
  const tip = (i: number) => `${data[i].label}: ${format(data[i].value)}`

  return (
    <figure className="rounded-xl border bg-card p-4">
      <figcaption className="mb-3 flex items-baseline justify-between gap-2">
        <span className="text-sm font-semibold">{title}</span>
        <span aria-live="polite" className="font-mono text-xs text-muted-foreground">{hot !== null ? tip(hot) : ''}</span>
      </figcaption>

      {orientation === 'horizontal' ? (
        <ul className="space-y-0.5">
          {data.map((d, i) => (
            <li key={d.label} className="grid grid-cols-[7.5rem_1fr_3.5rem] items-center gap-2 text-xs">
              <span className="truncate text-muted-foreground">{d.label}</span>
              <span className="h-3.5 rounded-sm" tabIndex={0} aria-label={tip(i)}
                onMouseEnter={() => setHot(i)} onMouseLeave={() => setHot(null)} onFocus={() => setHot(i)} onBlur={() => setHot(null)}>
                <span className={`block h-full rounded-r-[4px] bg-mark transition-opacity ${hot !== null && hot !== i ? 'opacity-40' : ''}`}
                  style={{ width: `${(d.value / max) * 100}%`, minWidth: d.value ? 2 : 0 }} />
              </span>
              <span className="text-right font-mono tabular-nums">{format(d.value)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="flex h-40 items-end gap-[2px] border-b">
          {data.map((d, i) => (
            <span key={d.label} className="flex h-full flex-1 items-end" tabIndex={0} aria-label={tip(i)}
              onMouseEnter={() => setHot(i)} onMouseLeave={() => setHot(null)} onFocus={() => setHot(i)} onBlur={() => setHot(null)}>
              <span className={`block w-full rounded-t-[4px] bg-mark transition-opacity ${hot !== null && hot !== i ? 'opacity-40' : ''}`}
                style={{ height: `${(d.value / max) * 100}%`, minHeight: d.value ? 2 : 0 }} />
            </span>
          ))}
        </div>
      )}
      {orientation === 'vertical' && (
        <div className="mt-1 flex justify-between font-mono text-[11px] text-muted-foreground">
          <span>{data[0]?.label}</span><span>{data.at(-1)?.label}</span>
        </div>
      )}

      <details className="mt-3 text-xs">
        <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Show as table</summary>
        <table className="mt-2 w-full">
          <tbody>
            {data.map(d => (
              <tr key={d.label} className="border-t">
                <td className="py-1 text-muted-foreground">{d.label}</td>
                <td className="py-1 text-right font-mono tabular-nums">{format(d.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  )
}
```

- [ ] **Step 2: Page** — `ui/src/components/StatsPage.tsx`

```tsx
import { useEffect, useState } from 'react'
import { getStats, type RateCalibration, type StatsResponse } from '@/lib/api'
import { STATUSES } from '@/lib/rows'
import { Bars } from '@/components/Bars'

const HOP_LABEL: Record<string, string> = {
  appliedToResponded: 'Applied → reply', respondedToInterview: 'Reply → interview',
  interviewToOffer: 'Interview → offer', appliedToRejected: 'Applied → rejection',
}

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
  return (
    <>
      <H2>Funnel</H2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label="Applied" value={funnel.everApplied} />
        <Tile label="Replied" value={funnel.everResponded} />
        <Tile label="Interviewed" value={funnel.everInterview} />
        <Tile label="Offers" value={funnel.everOffer} />
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <Rate name="Reply rate" c={cal.responseRate} />
        <Rate name="Interview rate" c={cal.interviewRate} />
      </div>

      <H2>Time between stages</H2>
      <ul className="divide-y rounded-xl border bg-card text-sm">
        {Object.entries(s.velocity.velocity).map(([k, h]) => (
          <li key={k} className="flex items-baseline justify-between px-4 py-2.5">
            <span>{HOP_LABEL[k] ?? `${h.from} → ${h.to}`}</span>
            <span className="font-mono text-muted-foreground">
              {h.insufficientData || h.median === null ? `Not enough data yet (n=${h.n})` : `${h.median} days median`}
            </span>
          </li>
        ))}
      </ul>

      <H2>Pipeline</H2>
      <div className="grid gap-3 md:grid-cols-2">
        <Bars title="Applications by status" data={STATUSES.map(st => ({ label: st === 'SKIP' ? 'Skipped' : st, value: tracker.byStatus[st] ?? 0 }))} />
        <div className="grid grid-cols-2 content-start gap-3">
          <Tile label="Tracked" value={tracker.total} />
          <Tile label="Avg fit, applied" value={tracker.avgScoreApplied.toFixed(1)} />
          <Tile label="Avg fit, all" value={tracker.avgScore.toFixed(1)} />
          <Tile label="Best fit" value={tracker.topScore.toFixed(1)} />
        </div>
      </div>

      <H2>Scanning</H2>
      <p className="mb-3 text-sm text-muted-foreground">
        <span className="font-mono text-foreground">{scan.totalRecorded.toLocaleString()}</span> postings from{' '}
        <span className="font-mono text-foreground">{scan.distinctCompanies.toLocaleString()}</span> companies since {scan.firstSeen}.
      </p>
      <div className="grid gap-3 md:grid-cols-2">
        <Bars title="New postings per week" orientation="vertical" data={scan.addedPerWeek.map(w => ({ label: w.week, value: w.count }))} />
        <Bars title="Postings by source" data={Object.entries(scan.byPortal).sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value }))} />
      </div>
    </>
  )
}
```

- [ ] **Step 3: Verify** — `cd ui && npm test && npm run build`; open `#/stats` on a worktree server (port 3701): four funnel tiles (133 / 1 / 1 / 0), both rate cards with source lines, the hops list shows "Not enough data yet" where applicable, three bar charts render; hovering or tabbing to a bar shows its value in the caption; "Show as table" expands; check dark mode (bars switch to the lighter `--mark`) and a 375px width (no page-level horizontal scroll). Current week's bar (W40, partial) is expected to be short.

- [ ] **Step 4: Commit**

```bash
git add ui/src/components/Bars.tsx ui/src/components/StatsPage.tsx
git commit -m "feat(ui): Stats — funnel vs benchmarks, stage velocity, pipeline and scanning charts

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Self-review notes

- Spec §4.1 items: follow-ups ✓ (T2/T4), digest roles + route + copy-evaluate ✓ (T1/T2/T4), worth applying ✓, quiet interviews ✓, funnel strip ✓; stale CVs deferred (out of scope above).
- §4.2 kanban: active statuses only, drag → set-status ✓ (T5); §4.6 Stats from stats.mjs + funnel-velocity.mjs ✓ (T6).
- Names used across tasks: `getToday`/`Today`, `getStats`/`StatsResponse`/`RateCalibration`/`Hop` (T3 → T4/T6); `BOARD`/`columns`/`dropMove` (T5); `bg-mark` from `--color-mark` (T3 → T6); `TodayPage`/`BoardPage` props `{ onOpen, refreshKey }`, `StatsPage` no props (T3 placeholders → T4–T6).
