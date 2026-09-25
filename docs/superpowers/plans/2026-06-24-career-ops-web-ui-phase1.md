# Career-Ops Web UI (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a local web app (browser UI + Node API) that onboards a user, shows their application board, and tracks progress — reusing the existing career-ops scripts and data files unchanged.

**Architecture:** A thin Node HTTP server (`server/`) wraps the existing `.mjs` engine and reads/writes the existing user-layer files (`cv.md`, `config/profile.yml`, `portals.yml`, `data/applications.md`, `reports/`). A static plain-HTML/JS frontend (`web/`) talks to it over JSON. No database; the markdown/YAML files stay the single source of truth.

**Tech Stack:** Node.js (ESM `.mjs`), built-in `http` module (no web framework), existing `js-yaml` dep, plain HTML/CSS/JS frontend. Tests follow the repo's existing `*-tests.mjs` PASS/FAIL-counter idiom run via `execFileSync` and registered in `test-all.mjs`.

## Global Constraints

- **No new npm dependencies.** Use Node built-in `http`, `fs`, `child_process`; YAML via the already-installed `js-yaml`.
- **Data contract is law.** Writes are allowed ONLY to user-layer paths: `cv.md`, `config/profile.yml`, `portals.yml`, `modes/_profile.md`, `data/*`, `reports/*`, `output/*`, `interview-prep/*`, `batch/tracker-additions/*`. Any write outside these must throw.
- **Never add tracker rows directly.** The web UI may only `PATCH` (update Status/Notes of) existing `data/applications.md` rows. New rows go through `batch/tracker-additions/` + `merge-tracker.mjs` (Phase 3+, out of scope here).
- **applications.md column order:** `# | Date | Company | Role | Score | Status | PDF | Report | Notes` (score BEFORE status). Parse by header NAME, never by fixed index (see repo #946).
- **Canonical statuses only** (case-insensitive match, exact label written): `Evaluated · Applied · Responded · Interview · Offer · Rejected · Discarded · SKIP` (source: `templates/states.yml`).
- **Atomic writes:** write to a temp file in the same directory, then `rename` over the target. Never partial-overwrite a data file.
- **Test idiom:** each test file is `server/<name>-tests.mjs`, prints `PASS <msg>`/`FAIL <msg>`, exits `0` on all-pass and `1` on any failure. Register in `test-all.mjs` with `expectExit: 0`.
- **Server port:** default `3700`, overridable via `CAREER_OPS_WEB_PORT`. Bind `127.0.0.1` only (local tool).
- **Repo root resolution:** scripts resolve the repo root from `import.meta.url` (see existing scripts), so the server works regardless of `cwd`.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `server/lib/markdown-table.mjs` | Parse/serialize the `applications.md` GFM table ↔ array of header-keyed row objects. |
| `server/lib/paths.mjs` | Repo-root resolution + data-contract write guard. |
| `server/lib/run.mjs` | Spawn an existing `.mjs` script, return `{code,stdout,stderr}`; JSON helper. |
| `server/lib/http.mjs` | Tiny HTTP helpers: read JSON body, send JSON, serve a static file, atomic file write. |
| `server/routes/setup.mjs` | `/api/setup/*` — status (doctor), write cv/profile/portals. |
| `server/routes/applications.mjs` | `/api/applications*` — list, get-one+report, patch status/notes. |
| `server/index.mjs` | Boot server, route table, serve `web/`. |
| `web/index.html` | Single-page shell with three views. |
| `web/style.css` | Styling. |
| `web/app.js` | Frontend logic: fetch APIs, render onboarding/board/progress. |
| `server/markdown-table-tests.mjs` | Tests for the table lib. |
| `server/paths-tests.mjs` | Tests for the path guard. |
| `server/routes-tests.mjs` | Integration tests booting the server against a temp fixture repo. |

---

## Task 1: Markdown table parser/serializer

**Files:**
- Create: `server/lib/markdown-table.mjs`
- Test: `server/markdown-table-tests.mjs`

**Interfaces:**
- Produces:
  - `parseTable(markdown: string) -> { headers: string[], rows: Array<Record<string,string>> }` — rows keyed by header text (trimmed). Ignores the `---|---` separator line and any non-table lines.
  - `serializeRows(headers: string[], rows: Array<Record<string,string>>) -> string` — emits a GFM table (header row + separator + data rows). Cells default to `''` for missing keys.
  - `findRowByNum(rows, num: string|number) -> Record<string,string> | undefined` — matches the `#` column.

- [ ] **Step 1: Write the failing test**

```js
// server/markdown-table-tests.mjs
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const HERE = dirname(fileURLToPath(import.meta.url));
let passed = 0, failed = 0;
const pass = m => { console.log(`PASS ${m}`); passed++; };
const fail = m => { console.error(`FAIL ${m}`); failed++; };
const eq = (a, b, m) => JSON.stringify(a) === JSON.stringify(b) ? pass(m) : fail(`${m} :: got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);

const { parseTable, serializeRows, findRowByNum } =
  await import(join(HERE, 'lib/markdown-table.mjs'));

const SAMPLE = `# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
| 1 | 2026-06-01 | Acme | Backend Engineer | 4.2/5 | Applied | ✅ | [1](reports/001-acme-2026-06-01.md) | strong fit |
| 2 | 2026-06-02 | Globex | Data Engineer | 3.1/5 | SKIP | ❌ | [2](reports/002-globex-2026-06-02.md) | low comp |
`;

const { headers, rows } = parseTable(SAMPLE);
eq(headers, ['#','Date','Company','Role','Score','Status','PDF','Report','Notes'], 'parses headers by name');
eq(rows.length, 2, 'parses two data rows');
eq(rows[0]['Company'], 'Acme', 'row keyed by header name');
eq(rows[1]['Status'], 'SKIP', 'status column not shifted');

const round = serializeRows(headers, rows);
eq(parseTable(round).rows, rows, 'round-trip parse(serialize(rows)) === rows');

eq(findRowByNum(rows, 2)['Company'], 'Globex', 'findRowByNum matches the # column');

// missing keys serialize as empty cells, not "undefined"
const out = serializeRows(['#','Status'], [{ '#': '9' }]);
eq(out.includes('undefined'), false, 'missing cell renders empty, not undefined');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node server/markdown-table-tests.mjs`
Expected: FAIL — `Cannot find module .../lib/markdown-table.mjs`.

- [ ] **Step 3: Write minimal implementation**

```js
// server/lib/markdown-table.mjs
// Parse/serialize the applications.md GFM table. Keyed by header NAME so
// inserting a column never shifts Score/Status (see repo #946).

function splitRow(line) {
  // Trim the outer pipes, then split. Keeps interior empty cells.
  const t = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return t.split('|').map(c => c.trim());
}

const isSeparator = cells => cells.length > 0 && cells.every(c => /^:?-{3,}:?$/.test(c));

export function parseTable(markdown) {
  const lines = markdown.split('\n');
  const tableLines = lines.filter(l => l.trim().startsWith('|') && l.includes('|'));
  if (tableLines.length === 0) return { headers: [], rows: [] };

  const headers = splitRow(tableLines[0]);
  const rows = [];
  for (const line of tableLines.slice(1)) {
    const cells = splitRow(line);
    if (isSeparator(cells)) continue;
    const row = {};
    headers.forEach((h, i) => { row[h] = cells[i] ?? ''; });
    rows.push(row);
  }
  return { headers, rows };
}

export function serializeRows(headers, rows) {
  const head = `| ${headers.join(' | ')} |`;
  const sep = `|${headers.map(() => '---').join('|')}|`;
  const body = rows.map(r => `| ${headers.map(h => (r[h] ?? '')).join(' | ')} |`);
  return [head, sep, ...body].join('\n') + '\n';
}

export function findRowByNum(rows, num) {
  const key = String(num).trim();
  return rows.find(r => String(r['#']).trim() === key);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node server/markdown-table-tests.mjs`
Expected: PASS — `6 passed, 0 failed` and exit 0.

- [ ] **Step 5: Commit**

```bash
git add server/lib/markdown-table.mjs server/markdown-table-tests.mjs
git commit -m "feat(web): add applications.md table parser/serializer"
```

---

## Task 2: Repo root + data-contract write guard

**Files:**
- Create: `server/lib/paths.mjs`
- Test: `server/paths-tests.mjs`

**Interfaces:**
- Produces:
  - `REPO_ROOT: string` — absolute repo root (two levels up from `server/lib/`).
  - `resolveUserPath(relPath: string) -> string` — joins to `REPO_ROOT`, throws `Error('write blocked: <relPath>')` if `relPath` is NOT under an allowed user-layer prefix.
  - `USER_LAYER_PREFIXES: string[]` — the allowed prefixes.

- [ ] **Step 1: Write the failing test**

```js
// server/paths-tests.mjs
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const HERE = dirname(fileURLToPath(import.meta.url));
let passed = 0, failed = 0;
const pass = m => { console.log(`PASS ${m}`); passed++; };
const fail = m => { console.error(`FAIL ${m}`); failed++; };
const ok = (cond, m) => cond ? pass(m) : fail(m);

const { resolveUserPath, REPO_ROOT } = await import(join(HERE, 'lib/paths.mjs'));

ok(resolveUserPath('cv.md').startsWith(REPO_ROOT), 'cv.md resolves under repo root');
ok(resolveUserPath('config/profile.yml').endsWith('config/profile.yml'), 'profile.yml allowed');
ok(resolveUserPath('data/applications.md').includes('data/'), 'data/* allowed');

let threw = false;
try { resolveUserPath('modes/_shared.md'); } catch { threw = true; }
ok(threw, 'system-layer modes/_shared.md is blocked');

threw = false;
try { resolveUserPath('../outside.txt'); } catch { threw = true; }
ok(threw, 'path traversal is blocked');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node server/paths-tests.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```js
// server/lib/paths.mjs
import { fileURLToPath } from 'url';
import { dirname, join, resolve, relative, isAbsolute } from 'path';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export const USER_LAYER_PREFIXES = [
  'cv.md',
  'config/profile.yml',
  'portals.yml',
  'modes/_profile.md',
  'data/',
  'reports/',
  'output/',
  'interview-prep/',
  'batch/tracker-additions/',
];

const allowed = rel =>
  USER_LAYER_PREFIXES.some(p => p.endsWith('/') ? rel.startsWith(p) : rel === p);

export function resolveUserPath(relPath) {
  const abs = join(REPO_ROOT, relPath);
  const rel = relative(REPO_ROOT, abs);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`write blocked: ${relPath}`);
  }
  // Normalize to forward slashes for prefix matching on all platforms.
  const norm = rel.split('\\').join('/');
  if (!allowed(norm)) throw new Error(`write blocked: ${relPath}`);
  return abs;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node server/paths-tests.mjs`
Expected: PASS — `5 passed, 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add server/lib/paths.mjs server/paths-tests.mjs
git commit -m "feat(web): add data-contract write guard"
```

---

## Task 3: Script runner

**Files:**
- Create: `server/lib/run.mjs`

**Interfaces:**
- Consumes: `REPO_ROOT` from `server/lib/paths.mjs`.
- Produces:
  - `runScript(script: string, args: string[], opts?: {timeout?: number}) -> Promise<{code:number, stdout:string, stderr:string}>` — runs `node <REPO_ROOT>/<script> <args>`; never rejects on non-zero exit (returns the code).
  - `runScriptJson(script: string, args: string[]) -> Promise<any>` — runs and `JSON.parse`s stdout; rejects if exit≠0 or parse fails.

- [ ] **Step 1: Write the implementation** (thin wrapper; covered by Task 6 integration tests via the `doctor` route)

```js
// server/lib/run.mjs
import { execFile } from 'child_process';
import { join } from 'path';
import { REPO_ROOT } from './paths.mjs';

export function runScript(script, args = [], { timeout = 120000 } = {}) {
  return new Promise(resolve => {
    execFile(process.execPath, [join(REPO_ROOT, script), ...args],
      { cwd: REPO_ROOT, timeout, encoding: 'utf-8', maxBuffer: 16 * 1024 * 1024 },
      (err, stdout, stderr) => {
        resolve({ code: err?.code ?? 0, stdout: stdout || '', stderr: stderr || (err?.message ?? '') });
      });
  });
}

export async function runScriptJson(script, args = []) {
  const { code, stdout, stderr } = await runScript(script, args);
  if (code !== 0) throw new Error(`${script} exited ${code}: ${stderr}`);
  return JSON.parse(stdout);
}
```

- [ ] **Step 2: Smoke-check manually**

Run: `node -e "import('./server/lib/run.mjs').then(m=>m.runScriptJson('doctor.mjs',['--json'])).then(j=>console.log('onboardingNeeded:',j.onboardingNeeded))"`
Expected: prints `onboardingNeeded: true` (or false) — proves it spawns `doctor.mjs` and parses JSON.

- [ ] **Step 3: Commit**

```bash
git add server/lib/run.mjs
git commit -m "feat(web): add .mjs script runner"
```

---

## Task 4: HTTP helpers + server bootstrap

**Files:**
- Create: `server/lib/http.mjs`
- Create: `server/index.mjs`

**Interfaces:**
- Produces (`http.mjs`):
  - `readJsonBody(req) -> Promise<any>` — collects and parses the request body (`{}` if empty).
  - `sendJson(res, status, obj)` — write a JSON response.
  - `serveStatic(res, absFile) -> Promise<boolean>` — stream a file with a content-type guess; `false` if not found.
  - `atomicWrite(absPath, content)` — temp-file + rename in the same dir.
- Produces (`index.mjs`):
  - `createServer() -> http.Server` — exported so tests can boot it on an ephemeral port; also auto-starts on `CAREER_OPS_WEB_PORT`/`3700` when run directly.

- [ ] **Step 1: Write `http.mjs`**

```js
// server/lib/http.mjs
import { createReadStream } from 'fs';
import { writeFile, rename, stat } from 'fs/promises';
import { dirname, join, extname } from 'path';

const TYPES = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css',
  '.json':'application/json', '.svg':'image/svg+xml', '.md':'text/markdown' };

export function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 8e6) req.destroy(); });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

export function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) });
  res.end(body);
}

export async function serveStatic(res, absFile) {
  try {
    const s = await stat(absFile);
    if (!s.isFile()) return false;
  } catch { return false; }
  res.writeHead(200, { 'content-type': TYPES[extname(absFile)] || 'application/octet-stream' });
  createReadStream(absFile).pipe(res);
  return true;
}

export async function atomicWrite(absPath, content) {
  const tmp = join(dirname(absPath), `.tmp-${process.pid}-${Date.now()}`);
  await writeFile(tmp, content, 'utf-8');
  await rename(tmp, absPath);
}
```

- [ ] **Step 2: Write `index.mjs`** (route table wired to handlers from Tasks 5–6; those imports exist after those tasks — order tasks 5,6 before running the server, but `createServer` itself is testable once handlers exist)

```js
// server/index.mjs
import http from 'http';
import { fileURLToPath } from 'url';
import { dirname, join, normalize } from 'path';
import { serveStatic, sendJson } from './lib/http.mjs';
import { REPO_ROOT } from './lib/paths.mjs';
import * as setup from './routes/setup.mjs';
import * as applications from './routes/applications.mjs';

const WEB_DIR = join(REPO_ROOT, 'web');

// [method, pattern(RegExp), handler(req,res,params)]
const ROUTES = [
  ['GET',   /^\/api\/setup\/status$/,        setup.getStatus],
  ['POST',  /^\/api\/setup\/cv$/,            setup.postCv],
  ['POST',  /^\/api\/setup\/profile$/,       setup.postProfile],
  ['POST',  /^\/api\/setup\/portals$/,       setup.postPortals],
  ['GET',   /^\/api\/applications$/,          applications.list],
  ['GET',   /^\/api\/applications\/([^/]+)$/, applications.getOne],
  ['PATCH', /^\/api\/applications\/([^/]+)$/, applications.patch],
];

async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  for (const [method, pattern, fn] of ROUTES) {
    if (req.method !== method) continue;
    const m = url.pathname.match(pattern);
    if (m) {
      try { return await fn(req, res, m.slice(1)); }
      catch (e) { return sendJson(res, 500, { error: e.message }); }
    }
  }
  if (req.method === 'GET') {
    const rel = url.pathname === '/' ? 'index.html' : normalize(url.pathname).replace(/^[/\\]+/, '');
    const file = join(WEB_DIR, rel);
    if (file.startsWith(WEB_DIR) && await serveStatic(res, file)) return;
  }
  sendJson(res, 404, { error: 'not found' });
}

export function createServer() { return http.createServer(handle); }

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.CAREER_OPS_WEB_PORT) || 3700;
  createServer().listen(port, '127.0.0.1', () =>
    console.log(`career-ops web UI → http://127.0.0.1:${port}`));
}
```

- [ ] **Step 3: Commit** (server won't fully boot until Tasks 5–6 land; that's expected — commit the infra now)

```bash
git add server/lib/http.mjs server/index.mjs
git commit -m "feat(web): add http helpers and server bootstrap"
```

---

## Task 5: Setup routes (onboarding)

**Files:**
- Create: `server/routes/setup.mjs`

**Interfaces:**
- Consumes: `runScriptJson` (run.mjs), `resolveUserPath`/`REPO_ROOT` (paths.mjs), `readJsonBody`/`sendJson`/`atomicWrite` (http.mjs), `js-yaml`.
- Produces (each `(req,res) -> Promise<void>`):
  - `getStatus` → `200 { onboardingNeeded, missing, warnings }` from `doctor.mjs --json`.
  - `postCv` body `{ markdown }` → writes `cv.md` → `200 { ok:true }`.
  - `postProfile` body `{ full_name,email,location,timezone,target_roles[],salary_target }` → writes `config/profile.yml` (seeded from `config/profile.example.yml`) → `200 { ok:true }`.
  - `postPortals` body `{ positiveKeywords?: string[] }` → copies `templates/portals.example.yml` → `portals.yml`, optionally sets `title_filter.positive` → `200 { ok:true }`.

- [ ] **Step 1: Write the implementation**

```js
// server/routes/setup.mjs
import { readFile } from 'fs/promises';
import { join } from 'path';
import yaml from 'js-yaml';
import { runScriptJson } from '../lib/run.mjs';
import { resolveUserPath, REPO_ROOT } from '../lib/paths.mjs';
import { readJsonBody, sendJson, atomicWrite } from '../lib/http.mjs';

export async function getStatus(req, res) {
  const status = await runScriptJson('doctor.mjs', ['--json']);
  sendJson(res, 200, status);
}

export async function postCv(req, res) {
  const { markdown } = await readJsonBody(req);
  if (!markdown || !markdown.trim()) return sendJson(res, 400, { error: 'markdown required' });
  await atomicWrite(resolveUserPath('cv.md'), markdown);
  sendJson(res, 200, { ok: true });
}

export async function postProfile(req, res) {
  const b = await readJsonBody(req);
  const example = await readFile(join(REPO_ROOT, 'config/profile.example.yml'), 'utf-8');
  const profile = yaml.load(example);
  profile.candidate.full_name = b.full_name ?? profile.candidate.full_name;
  profile.candidate.email = b.email ?? profile.candidate.email;
  profile.candidate.location = b.location ?? profile.candidate.location;
  if (Array.isArray(b.target_roles)) profile.target_roles.primary = b.target_roles;
  if (b.timezone) profile.location.timezone = b.timezone;
  if (b.salary_target) profile.compensation.target_range = b.salary_target;
  await atomicWrite(resolveUserPath('config/profile.yml'), yaml.dump(profile, { lineWidth: 100 }));
  sendJson(res, 200, { ok: true });
}

export async function postPortals(req, res) {
  const b = await readJsonBody(req);
  const example = await readFile(join(REPO_ROOT, 'templates/portals.example.yml'), 'utf-8');
  const portals = yaml.load(example);
  if (Array.isArray(b.positiveKeywords) && b.positiveKeywords.length) {
    portals.title_filter = portals.title_filter || {};
    portals.title_filter.positive = b.positiveKeywords;
  }
  await atomicWrite(resolveUserPath('portals.yml'), yaml.dump(portals, { lineWidth: 100 }));
  sendJson(res, 200, { ok: true });
}
```

- [ ] **Step 2: Manual smoke test**

Run: `CAREER_OPS_WEB_PORT=3791 node server/index.mjs &` then
`curl -s localhost:3791/api/setup/status`
Expected: JSON like `{"onboardingNeeded":true,"missing":[...],"warnings":[...]}`. Then `kill %1`.

- [ ] **Step 3: Commit**

```bash
git add server/routes/setup.mjs
git commit -m "feat(web): add onboarding setup routes"
```

---

## Task 6: Applications routes + integration tests

**Files:**
- Create: `server/routes/applications.mjs`
- Test: `server/routes-tests.mjs`

**Interfaces:**
- Consumes: `parseTable`/`serializeRows`/`findRowByNum` (markdown-table.mjs), `resolveUserPath` (paths.mjs), `readJsonBody`/`sendJson`/`atomicWrite` (http.mjs), `createServer` (index.mjs).
- Produces:
  - `list(req,res)` → `200 { rows, groups }` where `groups` maps each canonical status to its rows; empty tracker → `{ rows:[], groups:{} }`.
  - `getOne(req,res,[num])` → `200 { row, report }` (`report` = raw markdown of the linked report, or `null`); `404` if no such row.
  - `patch(req,res,[num])` body `{ status?, notes? }` → updates only Status/Notes of the existing row, rejects non-canonical status with `400`, `404` if row missing, else `200 { ok:true, row }`.

- [ ] **Step 1: Write the failing integration test**

```js
// server/routes-tests.mjs
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
let passed = 0, failed = 0;
const pass = m => { console.log(`PASS ${m}`); passed++; };
const fail = m => { console.error(`FAIL ${m}`); failed++; };
const ok = (c, m) => c ? pass(m) : fail(m);

// Boot the real server in a child process against the real repo, hit it over HTTP.
const PORT = 3799;
const srv = spawn(process.execPath, [join(ROOT, 'server/index.mjs')],
  { env: { ...process.env, CAREER_OPS_WEB_PORT: String(PORT) }, stdio: 'ignore' });

await new Promise(r => setTimeout(r, 800)); // give it a moment to bind

const base = `http://127.0.0.1:${PORT}`;
try {
  const status = await (await fetch(`${base}/api/setup/status`)).json();
  ok(typeof status.onboardingNeeded === 'boolean', 'GET /api/setup/status returns onboardingNeeded');

  const apps = await (await fetch(`${base}/api/applications`)).json();
  ok(Array.isArray(apps.rows), 'GET /api/applications returns rows[]');
  ok(typeof apps.groups === 'object', 'GET /api/applications returns groups{}');

  const idx = await (await fetch(`${base}/`)).text();
  ok(idx.includes('<') , 'GET / serves web/index.html');

  const bad = await fetch(`${base}/api/nope`);
  ok(bad.status === 404, 'unknown route → 404');
} finally {
  srv.kill();
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node server/routes-tests.mjs`
Expected: FAIL — `applications.mjs` route module missing → server errors / 500s; or `web/index.html` missing (Task 7) so the `GET /` assertion fails. Both are expected pre-implementation.

- [ ] **Step 3: Write the implementation**

```js
// server/routes/applications.mjs
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { parseTable, serializeRows, findRowByNum } from '../lib/markdown-table.mjs';
import { resolveUserPath, REPO_ROOT } from '../lib/paths.mjs';
import { readJsonBody, sendJson, atomicWrite } from '../lib/http.mjs';

const TRACKER = 'data/applications.md';
const CANON = ['Evaluated','Applied','Responded','Interview','Offer','Rejected','Discarded','SKIP'];

async function loadTracker() {
  const abs = join(REPO_ROOT, TRACKER);
  if (!existsSync(abs)) return { headers: [], rows: [], abs, raw: '' };
  const raw = await readFile(abs, 'utf-8');
  return { ...parseTable(raw), abs, raw };
}

export async function list(req, res) {
  const { rows } = await loadTracker();
  const groups = {};
  for (const r of rows) {
    const s = (r['Status'] || '').trim();
    (groups[s] ||= []).push(r);
  }
  sendJson(res, 200, { rows, groups });
}

export async function getOne(req, res, [num]) {
  const { rows } = await loadTracker();
  const row = findRowByNum(rows, num);
  if (!row) return sendJson(res, 404, { error: 'not found' });
  let report = null;
  const link = (row['Report'] || '').match(/\(([^)]+\.md)\)/);
  if (link) {
    const rel = link[1].replace(/^\.\.\//, '');
    const abs = join(REPO_ROOT, rel);
    if (existsSync(abs)) report = await readFile(abs, 'utf-8');
  }
  sendJson(res, 200, { row, report });
}

export async function patch(req, res, [num]) {
  const body = await readJsonBody(req);
  if (body.status && !CANON.some(c => c.toLowerCase() === String(body.status).toLowerCase())) {
    return sendJson(res, 400, { error: `non-canonical status: ${body.status}` });
  }
  const { headers, rows } = await loadTracker();
  const row = findRowByNum(rows, num);
  if (!row) return sendJson(res, 404, { error: 'not found' });
  if (body.status) row['Status'] = CANON.find(c => c.toLowerCase() === String(body.status).toLowerCase());
  if (body.notes !== undefined) row['Notes'] = String(body.notes).replace(/\n/g, ' ');
  // Preserve the file's preamble (title line) above the table.
  const raw = (await readFile(resolveUserPath(TRACKER), 'utf-8'));
  const preamble = raw.split('\n').filter(l => !l.trim().startsWith('|')).join('\n').trimEnd();
  await atomicWrite(resolveUserPath(TRACKER), `${preamble}\n\n${serializeRows(headers, rows)}`);
  sendJson(res, 200, { ok: true, row });
}
```

- [ ] **Step 4: Run the integration test** (will fully pass only after Task 7 creates `web/index.html`; until then expect the three API assertions to pass and the `GET /` assertion to fail)

Run: `node server/routes-tests.mjs`
Expected after Task 7: PASS — `5 passed, 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add server/routes/applications.mjs server/routes-tests.mjs
git commit -m "feat(web): add applications list/get/patch routes + integration tests"
```

---

## Task 7: Frontend (onboarding, board, progress)

**Files:**
- Create: `web/index.html`
- Create: `web/style.css`
- Create: `web/app.js`

**Interfaces:**
- Consumes the JSON API from Tasks 5–6. No exports.

- [ ] **Step 1: Write `web/index.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Career-Ops</title><link rel="stylesheet" href="/style.css">
</head>
<body>
  <header><h1>Career-Ops</h1>
    <nav>
      <button data-view="board" class="active">Applications</button>
      <button data-view="progress">Progress</button>
      <button data-view="onboard">Setup</button>
    </nav>
  </header>
  <main>
    <section id="onboard" hidden>
      <h2>Onboarding</h2>
      <div id="setup-status"></div>
      <label>Paste your CV (markdown)<textarea id="cv" rows="8"></textarea></label>
      <button id="save-cv">Save CV</button>
      <fieldset><legend>Profile</legend>
        <input id="full_name" placeholder="Full name">
        <input id="email" placeholder="Email">
        <input id="location" placeholder="Location (e.g. Kuala Lumpur, MY)">
        <input id="timezone" placeholder="Timezone (e.g. Asia/Kuala_Lumpur)">
        <input id="target_roles" placeholder="Target roles, comma-separated">
        <input id="salary_target" placeholder="Salary target (e.g. RM120k-160k)">
        <button id="save-profile">Save Profile</button>
      </fieldset>
      <fieldset><legend>Portals</legend>
        <input id="keywords" placeholder="Title keywords, comma-separated">
        <button id="save-portals">Save Portals</button>
      </fieldset>
    </section>
    <section id="board"><h2>Applications</h2><div id="board-cols"></div></section>
    <section id="progress" hidden><h2>Progress</h2><div id="funnel"></div></section>
  </main>
  <div id="modal" hidden><div id="modal-body"></div><button id="modal-close">Close</button></div>
  <script src="/app.js"></script>
</body>
</html>
```

- [ ] **Step 2: Write `web/style.css`**

```css
:root{--bg:#0d1117;--panel:#161b22;--line:#2a3240;--ink:#e6edf3;--muted:#9aa7b4;--accent:#5b8cff}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font-family:system-ui,sans-serif}
header{display:flex;align-items:center;gap:20px;padding:14px 22px;border-bottom:1px solid var(--line)}
nav button{background:none;border:1px solid var(--line);color:var(--ink);padding:6px 12px;border-radius:8px;cursor:pointer}
nav button.active{border-color:var(--accent);color:var(--accent)}
main{padding:22px;max-width:1100px;margin:0 auto}
input,textarea{display:block;width:100%;margin:6px 0;background:var(--panel);border:1px solid var(--line);color:var(--ink);border-radius:8px;padding:8px}
button{cursor:pointer}fieldset{border:1px solid var(--line);border-radius:10px;margin:14px 0}
#board-cols{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px}
.col{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:10px}
.col h3{margin:0 0 8px;font-size:13px;color:var(--muted);text-transform:uppercase}
.card{background:#1c2230;border:1px solid var(--line);border-radius:8px;padding:8px;margin:6px 0;font-size:13px;cursor:pointer}
#modal{position:fixed;inset:0;background:rgba(0,0,0,.6);padding:40px;overflow:auto}
#modal-body{max-width:760px;margin:0 auto;background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:20px;white-space:pre-wrap}
.bar{height:22px;background:var(--accent);border-radius:6px;margin:6px 0}
```

- [ ] **Step 3: Write `web/app.js`**

```js
const $ = s => document.querySelector(s);
const api = (url, opts) => fetch(url, opts).then(r => r.json());
const STATES = ['Evaluated','Applied','Responded','Interview','Offer','Rejected','Discarded','SKIP'];

function show(view) {
  for (const id of ['onboard','board','progress']) $('#'+id).hidden = id !== view;
  document.querySelectorAll('nav button').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  if (view === 'board') loadBoard();
  if (view === 'progress') loadProgress();
  if (view === 'onboard') loadStatus();
}
document.querySelectorAll('nav button').forEach(b => b.onclick = () => show(b.dataset.view));

async function loadStatus() {
  const s = await api('/api/setup/status');
  $('#setup-status').textContent = s.onboardingNeeded
    ? `Setup needed — missing: ${s.missing.join(', ')}`
    : 'All set ✓';
}
$('#save-cv').onclick = async () => {
  await api('/api/setup/cv', { method:'POST', headers:{'content-type':'application/json'},
    body: JSON.stringify({ markdown: $('#cv').value }) });
  loadStatus();
};
$('#save-profile').onclick = async () => {
  await api('/api/setup/profile', { method:'POST', headers:{'content-type':'application/json'},
    body: JSON.stringify({
      full_name: $('#full_name').value, email: $('#email').value, location: $('#location').value,
      timezone: $('#timezone').value, salary_target: $('#salary_target').value,
      target_roles: $('#target_roles').value.split(',').map(s=>s.trim()).filter(Boolean) }) });
  loadStatus();
};
$('#save-portals').onclick = async () => {
  await api('/api/setup/portals', { method:'POST', headers:{'content-type':'application/json'},
    body: JSON.stringify({ positiveKeywords: $('#keywords').value.split(',').map(s=>s.trim()).filter(Boolean) }) });
  loadStatus();
};

async function loadBoard() {
  const { groups } = await api('/api/applications');
  $('#board-cols').innerHTML = '';
  for (const st of STATES) {
    const rows = groups[st] || [];
    const col = document.createElement('div'); col.className = 'col';
    col.innerHTML = `<h3>${st} (${rows.length})</h3>`;
    for (const r of rows) {
      const card = document.createElement('div'); card.className = 'card';
      card.textContent = `${r['Company']} — ${r['Role']} (${r['Score']||''})`;
      card.onclick = () => openReport(r['#']);
      col.appendChild(card);
    }
    $('#board-cols').appendChild(col);
  }
}

async function openReport(num) {
  const { row, report } = await api('/api/applications/' + encodeURIComponent(num));
  $('#modal-body').textContent = report || `${row['Company']} — ${row['Role']}\n(no report file)`;
  $('#modal').hidden = false;
}
$('#modal-close').onclick = () => $('#modal').hidden = true;

async function loadProgress() {
  const { groups } = await api('/api/applications');
  const max = Math.max(1, ...STATES.map(s => (groups[s]||[]).length));
  $('#funnel').innerHTML = STATES.map(s => {
    const n = (groups[s]||[]).length;
    return `<div>${s}: ${n}<div class="bar" style="width:${(n/max)*100}%"></div></div>`;
  }).join('');
}

show('board');
```

- [ ] **Step 4: Run the integration test (now complete)**

Run: `node server/routes-tests.mjs`
Expected: PASS — `5 passed, 0 failed` (the `GET /` assertion now finds `web/index.html`).

- [ ] **Step 5: Manual visual check**

Run: `node server/index.mjs` then open `http://127.0.0.1:3700`. Confirm the three tabs render, Setup shows the onboarding status, and the board loads (empty until a tracker exists).

- [ ] **Step 6: Commit**

```bash
git add web/index.html web/style.css web/app.js
git commit -m "feat(web): add onboarding, application board, and progress UI"
```

---

## Task 8: Wire npm script, test registration, and docs

**Files:**
- Modify: `package.json` (add `web` script)
- Modify: `test-all.mjs` (register the three new test files)
- Create: `docs/WEB_UI.md`

- [ ] **Step 1: Add the npm script**

In `package.json` `scripts`, add after the `"tracker"` line:

```json
    "web": "node server/index.mjs",
```

- [ ] **Step 2: Register tests in `test-all.mjs`**

In the array that lists script tests (near the `tracker-columns-tests.mjs` entry at `test-all.mjs:160`), add:

```js
  { name: 'server/markdown-table-tests.mjs', expectExit: 0 },
  { name: 'server/paths-tests.mjs', expectExit: 0 },
  { name: 'server/routes-tests.mjs', expectExit: 0 },
```

- [ ] **Step 3: Write `docs/WEB_UI.md`**

```markdown
# Career-Ops Web UI (local)

A browser UI for onboarding, managing applications, and tracking progress.
It reuses the existing career-ops scripts and data files — no database.

## Run

    npm run web        # serves http://127.0.0.1:3700
    # or: CAREER_OPS_WEB_PORT=4000 npm run web

## What it does

- **Setup** — paste your CV, fill your profile, set portal keywords. Writes
  `cv.md`, `config/profile.yml`, `portals.yml` (user-layer files only).
- **Applications** — a board of `data/applications.md` grouped by canonical
  status; click a card to read its report.
- **Progress** — a funnel of counts across the 8 canonical states.

## Boundaries

- The UI never submits an application and never adds tracker rows directly.
  It only updates Status/Notes of existing entries (data-contract safe).
- All writes are restricted to user-layer paths; system files are never touched.
```

- [ ] **Step 4: Run the full suite**

Run: `node test-all.mjs --quick`
Expected: PASS including the three new `server/*-tests.mjs` entries.

- [ ] **Step 5: Commit**

```bash
git add package.json test-all.mjs docs/WEB_UI.md
git commit -m "feat(web): wire npm script, tests, and docs for the web UI"
```

---

## Self-Review Notes (for the implementer)

- **Task order matters for `routes-tests.mjs`:** it boots the whole server, so it only fully passes after Task 7 (it needs `web/index.html`). Tasks 1–2 and their unit tests are independently green immediately. If running strictly task-by-task, expect the `GET /` assertion in Task 6 to go green at Task 7 — this is called out in both tasks.
- **No new dependencies** introduced — verified against the Global Constraints.
- **Data-contract guard** (`resolveUserPath`) gates every write in Tasks 5–6; `data/applications.md`, `cv.md`, `config/profile.yml`, `portals.yml` are all under allowed prefixes.
- **Column-order safety:** the tracker is parsed/written by header name (Task 1), so Score/Status never shift.
- **Out of scope (later phases):** job-source providers (#2), title→list search (#3), per-job CV generation wiring (#4), auto-pilot (#5). Each gets its own spec+plan.
