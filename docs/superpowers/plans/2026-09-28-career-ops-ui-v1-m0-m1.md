# Career-Ops UI v1 — M0 + M1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden the existing local Node server (M0) and ship the first React screen — an applications table with a job detail drawer that can change status and append notes (M1).

**Architecture:** `server/` stays plain Node `http` on 127.0.0.1:3700 and becomes the only writer, delegating every tracker write to `set-status.mjs`. A new `ui/` (Vite + React + TypeScript + Tailwind + shadcn/ui) builds to `ui/dist/`, which the server serves in place of the old vanilla `web/` once it exists. The files remain the only database.

**Tech Stack:** Node 26 (`.mjs`, no framework), `yaml` 2.x (comment-preserving writes), Vite 8, React 19, TypeScript, Tailwind 4, shadcn/ui, `react-markdown`, Vitest (ui only).

**Spec:** `docs/superpowers/specs/2026-09-28-career-ops-ui-v1-design.md` — read §2 (decisions U1–U11) and §3.1 (hard requirements) before starting.

## Global Constraints

- Files are the only database. No DB, no auth, no new persistence (spec U1).
- Every tracker write goes through `node set-status.mjs … --source web --json`. The server never edits `data/applications.md` itself (spec U5).
- Every non-GET request must carry an `Origin` whose host is the server's own, and every request's `Host` must be `127.0.0.1:<port>` or `localhost:<port>` (spec §3.1).
- Whole-file writes (`cv.md`, `config/profile.yml`, `portals.yml`) accept a `version` (sha1 of the file as loaded) and return `409` when the file changed on disk (spec §3.1).
- YAML writes must preserve comments: `yaml` package Document API, never `js-yaml` `dump` (spec §3.1).
- Server binds `127.0.0.1` only (already true — do not change).
- No AI triggers. Anything needing judgement is a copy-prompt, not a button that runs Claude (spec U6).
- `ui/` has its own `package.json` and `node_modules`; do not add frontend dependencies to the root `package.json`.
- **git on this machine:** `/usr/bin/git` exits 69 (Xcode license). Use `/Applications/Xcode.app/Contents/Developer/usr/bin/git` for every git command below (written as `git` for brevity).
- **Work on a fresh branch from `main`** (e.g. `feat/ui-v1`), ideally in a worktree — the current checkout has someone else's uncommitted edits to `set-status.mjs`, `AGENTS.md` and others. Do not commit those.
- **Run server tests file by file** (`node server/<name>-tests.mjs`), not via `test-all.mjs`, which crashes on the codegraph socket in this environment.

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `server/lib/guard.mjs` | Create | `isAllowedRequest(req)` — Host + Origin check |
| `server/lib/versioned.mjs` | Create | `fileVersion(abs)`, `isStale(abs, expected)` — content-hash versions |
| `server/lib/detail.mjs` | Create | Pure parsers for the detail drawer: status-log, follow-ups, report number, output dir |
| `server/routes/files.mjs` | Create | `GET /api/files/(output\|jds)/…` — serve PDFs and JD captures, path-guarded |
| `server/index.mjs` | Modify | Guard every request; serve `ui/dist` when built; new routes |
| `server/lib/http.mjs` | Modify | Add MIME types (`.pdf`, `.png`, `.ico`, `.woff2`) |
| `server/routes/applications.mjs` | Modify | Tracker via `resolveTrackerPath`; PATCH via `set-status.mjs`; enriched `getOne`; `appliedOn` in `list` |
| `server/routes/setup.mjs` | Modify | Comment-preserving YAML; portals based on existing file; 409 on stale version |
| `server/guard-tests.mjs`, `server/versioned-tests.mjs`, `server/detail-tests.mjs`, `server/applications-tests.mjs` | Create | Tests |
| `server/routes-tests.mjs` | Modify | Send `Origin`; assert comments survive, 403 without Origin, 409 on stale version |
| `package.json` | Modify | `yaml` dep; `test:server`, `ui:dev`, `ui:build` scripts |
| `ui/` | Create | Vite React app |
| `ui/src/lib/api.ts` | Create | Typed fetch wrapper |
| `ui/src/lib/rows.ts` (+ `rows.test.ts`) | Create | Score parsing, filtering, presets, sorting |
| `ui/src/components/ApplicationsTable.tsx` | Create | Table, search, filters, presets, sort |
| `ui/src/components/JobDrawer.tsx` | Create | Detail drawer (read + status/note edit) |
| `config/local-paths.txt` | Modify (gitignored, local only) | Declare `ui/` so the updater never prunes it |

---

## M0 — Server hardening

### Task 1: Origin/Host guard + server test script

**Files:**
- Create: `server/lib/guard.mjs`, `server/guard-tests.mjs`
- Modify: `server/index.mjs` (top of `handle`), `server/routes-tests.mjs` (send `Origin`), `package.json` (scripts)

**Interfaces:**
- Produces: `isAllowedRequest(req: IncomingMessage): boolean`. Every later task's integration tests must send `origin: http://127.0.0.1:<port>` on non-GET requests.

- [ ] **Step 1: Write the failing unit test** — `server/guard-tests.mjs`

```js
// server/guard-tests.mjs
import { isAllowedRequest } from './lib/guard.mjs';

let passed = 0, failed = 0;
const ok = (c, m) => { if (c) { console.log(`PASS ${m}`); passed++; } else { console.error(`FAIL ${m}`); failed++; } };
const req = (method, headers) => ({ method, headers, socket: { localPort: 3700 } });

ok(isAllowedRequest(req('GET', { host: '127.0.0.1:3700' })), 'same-host GET allowed');
ok(isAllowedRequest(req('GET', { host: 'localhost:3700' })), 'localhost GET allowed');
ok(!isAllowedRequest(req('GET', { host: 'evil.example:3700' })), 'foreign Host rejected (DNS rebinding)');
ok(isAllowedRequest(req('POST', { host: '127.0.0.1:3700', origin: 'http://127.0.0.1:3700' })), 'same-origin POST allowed');
ok(isAllowedRequest(req('PATCH', { host: '127.0.0.1:3700', origin: 'http://localhost:3700' })), 'localhost-origin PATCH allowed');
ok(!isAllowedRequest(req('POST', { host: '127.0.0.1:3700', origin: 'https://evil.example' })), 'cross-origin POST rejected');
ok(!isAllowedRequest(req('POST', { host: '127.0.0.1:3700' })), 'POST without Origin rejected');
ok(!isAllowedRequest(req('POST', { host: '127.0.0.1:3700', origin: 'null' })), 'opaque "null" Origin rejected');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
```

- [ ] **Step 2: Run it — expect failure**

Run: `node server/guard-tests.mjs`
Expected: `Error [ERR_MODULE_NOT_FOUND]` for `./lib/guard.mjs`.

- [ ] **Step 3: Implement** — `server/lib/guard.mjs`

```js
// server/lib/guard.mjs
// Localhost CSRF + DNS-rebinding guard. Any website the user visits can POST to
// 127.0.0.1 (a text/plain body skips the CORS preflight), and a rebinding
// domain can make GETs look same-origin. So: Host must be ours on every request,
// and every state-changing request must carry an Origin that is ours too.
// Browsers always send Origin on POST/PATCH/PUT/DELETE; a missing one means a
// non-browser client, which must opt in by sending it.
export function isAllowedRequest(req) {
  const port = req.socket?.localPort;
  const ours = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  if (!ours.has(req.headers.host)) return false;
  if (req.method === 'GET' || req.method === 'HEAD') return true;
  const origin = req.headers.origin;
  if (!origin) return false;
  try { return ours.has(new URL(origin).host); } catch { return false; }
}
```

- [ ] **Step 4: Wire into `server/index.mjs`** — add the import and make it the first line of `handle`:

```js
import { isAllowedRequest } from './lib/guard.mjs';
```

```js
async function handle(req, res) {
  if (!isAllowedRequest(req)) return sendJson(res, 403, { error: 'forbidden: foreign Host or cross-origin request' });
  const url = new URL(req.url, 'http://localhost');
```

- [ ] **Step 5: Make the existing integration test send Origin** — in `server/routes-tests.mjs`, after `const base = …`, add `const ORIGIN = { origin: base };`, then:
  - change `jsonPost` to `fetch(\`${base}${path}\`, { method: 'POST', headers: { 'content-type': 'application/json', ...ORIGIN }, body: JSON.stringify(body) })`
  - add `headers: ORIGIN` to both `/api/setup/cv/upload` fetches
  - add, right after the `unknown route → 404` assertion:

```js
  const noOrigin = await fetch(`${base}/api/setup/cv`, { method: 'POST', body: '{"markdown":"x"}' });
  ok(noOrigin.status === 403, 'POST without Origin → 403');
  const evil = await fetch(`${base}/api/setup/cv`, { method: 'POST', headers: { origin: 'https://evil.example' }, body: '{"markdown":"x"}' });
  ok(evil.status === 403, 'cross-origin POST → 403');
```

- [ ] **Step 6: Add scripts to root `package.json`** (inside `"scripts"`, next to `"web"`):

```json
    "test:server": "for f in server/*-tests.mjs; do node \"$f\" || exit 1; done",
```

- [ ] **Step 7: Run**

Run: `node server/guard-tests.mjs && node server/routes-tests.mjs`
Expected: `8 passed, 0 failed`, then routes-tests all PASS including the two new 403 lines. (routes-tests writes real `cv.md`/`profile.yml`/`portals.yml` and restores them from a snapshot in `finally` — that is existing behaviour.)

- [ ] **Step 8: Commit**

```bash
git add server/lib/guard.mjs server/guard-tests.mjs server/index.mjs server/routes-tests.mjs package.json
git commit -m "fix(server): reject foreign Host and cross-origin writes (localhost CSRF guard)"
```

---

### Task 2: Tracker writes through `set-status.mjs`

**Files:**
- Modify: `server/routes/applications.mjs`
- Create: `server/applications-tests.mjs`, `server/fixtures/applications.md`

**Interfaces:**
- Consumes: `runScript(script, args)` from `server/lib/run.mjs` → `{ code, stdout, stderr }`; `resolveTrackerPath`, `getCareerOpsRoot` from `path-resolver.mjs`.
- Produces: `PATCH /api/applications/:num` body `{ status?: string, note?: string }` (at least one). `note` is **new text only** — `set-status` appends it. Response `200` = set-status's JSON (`{ changed, num, oldStatus, newStatus, note?, statusLogged? … }`); `400` bad input / non-canonical state, `404` no such row, `409` ambiguous, `503` tracker lock busy — each with set-status's `{ error, code }` body.
- Produces: the tracker is read from `resolveTrackerPath(getCareerOpsRoot())`, so `CAREER_OPS_TRACKER` redirects it (tests rely on this).

- [ ] **Step 1: Create the fixture** — `server/fixtures/applications.md`

```markdown
# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
| 1 | 2026-09-01 | Acme | Backend Engineer | 4.2/5 | Evaluated | ❌ | [001](reports/001-acme-2026-09-01.md) | strong fit |
| 2 | 2026-09-02 | Globex | Full Stack Developer | 3.6/5 | Evaluated | ❌ | [002](reports/002-globex-2026-09-02.md) | — |
| 3 | 2026-09-03 | Initech | .NET Developer | 3.9/5 | Applied | ✅ | [003](reports/003-initech-2026-09-03.md) | applied via site |
```

- [ ] **Step 2: Write the failing integration test** — `server/applications-tests.mjs`

```js
// server/applications-tests.mjs
// Boots the real server against a TEMP tracker (CAREER_OPS_TRACKER) so the
// user's data/applications.md is never touched. set-status.mjs inherits the
// env and writes status-log.tsv next to the temp tracker.
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { mkdtempSync, copyFileSync, readFileSync, existsSync, rmSync } from 'fs';
import { tmpdir } from 'os';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
let passed = 0, failed = 0;
const ok = (c, m) => { if (c) { console.log(`PASS ${m}`); passed++; } else { console.error(`FAIL ${m}`); failed++; } };

const dir = mkdtempSync(join(tmpdir(), 'co-apps-'));
const tracker = join(dir, 'applications.md');
copyFileSync(join(HERE, 'fixtures/applications.md'), tracker);

const PORT = 3798;
const base = `http://127.0.0.1:${PORT}`;
const srv = spawn(process.execPath, [join(ROOT, 'server/index.mjs')],
  { env: { ...process.env, CAREER_OPS_WEB_PORT: String(PORT), CAREER_OPS_TRACKER: tracker }, stdio: 'ignore' });

async function waitForServer(maxMs = 10000) {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    try { if ((await fetch(`${base}/api/applications`)).ok) return; } catch {}
    await new Promise(r => setTimeout(r, 50));
  }
  throw new Error('server did not start in time');
}
const patch = (num, body) => fetch(`${base}/api/applications/${num}`,
  { method: 'PATCH', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify(body) });

try {
  await waitForServer();
  const list = await (await fetch(`${base}/api/applications`)).json();
  ok(list.rows.length === 3, 'GET /api/applications reads the CAREER_OPS_TRACKER file');

  const r1 = await patch(2, { status: 'Applied' });
  const b1 = await r1.json();
  ok(r1.status === 200 && b1.newStatus === 'Applied', 'PATCH status → 200 with set-status JSON');
  ok(readFileSync(tracker, 'utf-8').includes('| Globex | Full Stack Developer | 3.6/5 | Applied |'), 'tracker row updated');
  const logPath = join(dir, 'status-log.tsv');
  const log = existsSync(logPath) ? readFileSync(logPath, 'utf-8') : '';
  ok(/^2\t\d{4}-\d{2}-\d{2}\tEvaluated\tApplied\tweb\t/m.test(log), 'status-log.tsv gets a web-sourced transition');

  const r2 = await patch(1, { note: 'recruiter pinged' });
  ok(r2.status === 200, 'PATCH note-only → 200');
  ok(readFileSync(tracker, 'utf-8').includes('strong fit; recruiter pinged'), 'note appended, not replaced');
  const log2 = readFileSync(logPath, 'utf-8');
  ok(!/^1\t/m.test(log2), 'note-only change logs no transition');

  ok((await patch(1, { status: 'Bogus' })).status === 400, 'non-canonical status → 400');
  ok((await patch(999, { status: 'Applied' })).status === 404, 'unknown row → 404');
  ok((await patch(1, {})).status === 400, 'empty body → 400');
  ok((await patch('abc', { status: 'Applied' })).status === 400, 'non-numeric row → 400');
  ok((await patch(3, { status: 'Hired' })).status === 200, 'Hired is accepted (old CANON list omitted it)');
} finally {
  srv.kill();
  rmSync(dir, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
```

- [ ] **Step 3: Run it — expect failures**

Run: `node server/applications-tests.mjs`
Expected: FAIL on "reads the CAREER_OPS_TRACKER file" (server reads the real tracker) and on the status-log / note-append / Hired assertions.

- [ ] **Step 4: Implement** — replace the top of `server/routes/applications.mjs` through the end of `patch` with:

```js
// server/routes/applications.mjs
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { parseTable, findRowByNum } from '../lib/markdown-table.mjs';
import { REPO_ROOT } from '../lib/paths.mjs';
import { readJsonBody, sendJson } from '../lib/http.mjs';
import { runScript } from '../lib/run.mjs';
import { resolveTrackerPath, getCareerOpsRoot } from '../../path-resolver.mjs';

// set-status.mjs exit codes → HTTP. It owns validation, the tracker lock, the
// atomic write and the status-log.tsv ledger; this route only translates.
const EXIT_HTTP = { 1: 400, 2: 404, 3: 409, 4: 503 };

async function loadTracker() {
  const abs = resolveTrackerPath(getCareerOpsRoot());
  if (!existsSync(abs)) return { headers: [], rows: [], abs, raw: '' };
  const raw = await readFile(abs, 'utf-8');
  return { ...parseTable(raw), abs, raw };
}
```

(`list` and `getOne` stay as they are.) Then replace `patch`:

```js
export async function patch(req, res, [num]) {
  if (!/^\d+$/.test(num)) return sendJson(res, 400, { error: 'row number must be a positive integer' });
  const body = await readJsonBody(req);
  const note = typeof body.note === 'string' ? body.note.trim() : '';
  let status = typeof body.status === 'string' ? body.status.trim() : '';
  if (!status && !note) return sendJson(res, 400, { error: 'status or note required' });
  if (!status) {
    // set-status needs a state with --row; restating the current one is a
    // no-op for status and logs no transition.
    const row = findRowByNum((await loadTracker()).rows, num);
    if (!row) return sendJson(res, 404, { error: `no tracker row #${num}` });
    status = row['Status'];
  }
  const args = ['--row', num, status, '--source', 'web', '--json'];
  if (note) args.push('--note', note);
  const { code, stdout, stderr } = await runScript('set-status.mjs', args);
  let out;
  try { out = JSON.parse(stdout); } catch { out = { error: (stderr || stdout).trim() || 'set-status failed' }; }
  sendJson(res, code === 0 ? 200 : (EXIT_HTTP[code] ?? 500), out);
}
```

The old `CANON` list, `serializeRows`, `spliceTable`, `atomicWrite`, `resolveUserPath` and the `TRACKER` constant are now unused in this file — remove them from the imports. Do not delete them from `markdown-table.mjs`; other code and tests may use them.

- [ ] **Step 5: Run**

Run: `node server/applications-tests.mjs && node server/routes-tests.mjs`
Expected: `12 passed, 0 failed`; routes-tests still green.

- [ ] **Step 6: Commit**

```bash
git add server/routes/applications.mjs server/applications-tests.mjs server/fixtures/applications.md
git commit -m "fix(server): route tracker writes through set-status.mjs (lock, validation, status-log)"
```

---

### Task 3: Comment-preserving YAML writes; portals no longer reset from template

**Files:**
- Modify: `server/routes/setup.mjs`, `server/routes-tests.mjs`, `package.json` (dependency)

**Interfaces:**
- Consumes: `yaml` 2.x — `parseDocument(text)`, `doc.setIn(path, doc.createNode(value))`, `doc.toJS()`, `String(doc)`.
- Produces: `postProfile` / `postPortals` / `syncPortalsLocationFilter` write the user's existing file with comments intact. `postPortals` bases off the existing `portals.yml` (falls back to `templates/portals.example.yml` only when it doesn't exist).

**Why:** `js-yaml` load → dump deletes all 58 comment lines in `config/profile.yml` and 41 in `portals.yml`. Separately, `postPortals` rebuilds `portals.yml` from the example template on every save, silently dropping the user's `tracked_companies` and filters.

- [ ] **Step 1: Install**

Run: `npm install yaml@^2.9.1`
Expected: `package.json` `dependencies` gains `"yaml": "^2.9.1"`.

- [ ] **Step 2: Add failing assertions to `server/routes-tests.mjs`** — after the `profile persists location.preferred` assertion:

```js
  // Comments must survive a save (js-yaml dump used to strip all of them).
  const firstComment = s => s?.toString().split('\n').find(l => l.trim().startsWith('#'));
  const profComment = firstComment(origProfile);
  if (profComment) ok(readFileSync(profilePath, 'utf-8').includes(profComment), 'profile.yml comments survive a save');
  const portComment = firstComment(origPortals);
  if (portComment) ok(readFileSync(portalsPath, 'utf-8').includes(portComment), 'portals.yml comments survive a save');
  // Save Portals must not reset the user's tracked companies to the template.
  const origCompanies = origPortals ? (yaml.load(origPortals.toString())?.tracked_companies ?? []).length : 0;
  if (origCompanies) ok((savedPortals.tracked_companies ?? []).length === origCompanies, 'portals save keeps tracked_companies');
```

- [ ] **Step 3: Run — expect failure**

Run: `node server/routes-tests.mjs`
Expected: FAIL on the three new assertions (given the real profile/portals have comments and companies).

- [ ] **Step 4: Implement** — in `server/routes/setup.mjs`:

Add the import (keep `js-yaml` for `getData`'s reads — reading is lossless):

```js
import { parseDocument } from 'yaml';
```

Add a helper below the constants:

```js
// Comment-preserving YAML edit: parse to a Document, set paths, stringify.
// js-yaml's load→dump round trip drops every comment in the user's file.
function yamlDoc(text) {
  const doc = parseDocument(text);
  const set = (path, value) => doc.setIn(path, doc.createNode(value));
  return { doc, set, js: doc.toJS() };
}
```

Replace `syncPortalsLocationFilter`'s body after the early return:

```js
  const { doc, set, js } = yamlDoc(await readFile(portalsPath, 'utf-8'));
  if (!js || typeof js !== 'object') return false;
  set(['location_filter', 'allow'], locations);
  await atomicWrite(resolveUserPath('portals.yml'), String(doc));
  return true;
```

Replace `postProfile` from `const profile = yaml.load(…)` down to (and including) its `atomicWrite` line with:

```js
  const { doc, set, js: profile } = yamlDoc(await readFile(src, 'utf-8'));
  if (!profile || !profile.candidate || !profile.target_roles || !profile.location || !profile.compensation) {
    return sendJson(res, 500, { error: 'profile template is missing or malformed' });
  }
  if (b.full_name !== undefined) set(['candidate', 'full_name'], b.full_name);
  if (b.email !== undefined) set(['candidate', 'email'], b.email);
  if (b.location !== undefined) set(['candidate', 'location'], b.location);
  if (b.phone) set(['candidate', 'phone'], b.phone);
  if (b.linkedin) set(['candidate', 'linkedin'], b.linkedin);
  if (b.github) set(['candidate', 'github'], b.github);
  if (Array.isArray(b.target_roles)) set(['target_roles', 'primary'], b.target_roles);
  if (b.timezone) set(['location', 'timezone'], b.timezone);
  if (b.salary_target) set(['compensation', 'target_range'], b.salary_target);
  if (b.salary_period) set(['compensation', 'period'], b.salary_period);
  if (b.preferred_location) set(['location', 'preferred'], b.preferred_location);
  // Narrative fields are authoritative from the form (sent as raw text every save).
  if (b.headline !== undefined) set(['narrative', 'headline'], b.headline);
  if (b.exit_story !== undefined) set(['narrative', 'exit_story'], b.exit_story);
  if (b.superpowers !== undefined) set(['narrative', 'superpowers'], parseList(b.superpowers));
  if (b.proof_points !== undefined) set(['narrative', 'proof_points'], parseProofPoints(b.proof_points));
  await atomicWrite(resolveUserPath(PROFILE), String(doc));
```

(The old code used `b.full_name ?? existing`, which is the same as "set only when provided"; `undefined` checks keep that behaviour.)

Replace `postPortals` from its first line through its `atomicWrite` with:

```js
  const b = await readJsonBody(req);
  // Base off the user's EXISTING portals.yml — rebuilding from the example
  // template on every save dropped their tracked_companies and filters.
  const portalsPath = join(REPO_ROOT, 'portals.yml');
  const src = existsSync(portalsPath) ? portalsPath : join(REPO_ROOT, 'templates/portals.example.yml');
  const { doc, set, js } = yamlDoc(await readFile(src, 'utf-8'));
  if (!js || typeof js !== 'object') {
    return sendJson(res, 500, { error: 'portals.yml is missing or malformed' });
  }
  if (Array.isArray(b.positiveKeywords) && b.positiveKeywords.length) {
    set(['title_filter', 'positive'], b.positiveKeywords);
  }
  // Seed the location filter from the user's saved preferred location, so a
  // Save Portals after Save Profile still applies it (and vice-versa).
  const profilePath = join(REPO_ROOT, 'config/profile.yml');
  if (existsSync(profilePath)) {
    const prof = yaml.load(await readFile(profilePath, 'utf-8'));
    const locs = parsePreferredLocations(prof?.location?.preferred);
    if (locs.length) set(['location_filter', 'allow'], locs);
  }
  await atomicWrite(resolveUserPath('portals.yml'), String(doc));
```

- [ ] **Step 5: Run**

Run: `node server/routes-tests.mjs`
Expected: all PASS, including the three new lines. Then `git diff --stat config/profile.yml portals.yml` shows nothing (they're gitignored user files — confirm with `diff` against a copy taken before the run if in doubt).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json server/routes/setup.mjs server/routes-tests.mjs
git commit -m "fix(server): preserve YAML comments on save; stop resetting portals.yml to the template"
```

---

### Task 4: Version check → 409 on whole-file writes

**Files:**
- Create: `server/lib/versioned.mjs`, `server/versioned-tests.mjs`
- Modify: `server/routes/setup.mjs` (`getData`, `postCv`, `postProfile`, `postPortals`), `server/routes-tests.mjs`

**Interfaces:**
- Produces: `fileVersion(abs: string): Promise<string|null>` (sha1 hex of bytes, `null` if missing); `isStale(abs: string, expected: string|undefined): Promise<boolean>` (`false` when `expected` is `undefined`).
- Produces: `GET /api/setup/data` gains `versions: { cv, profile, portals }`. `POST /api/setup/cv|profile|portals` accept `version` in the JSON body; stale → `409 { error: 'changed on disk — reload', currentVersion }`, file untouched. Missing `version` is accepted so the legacy `web/` UI keeps working until M4 deletes it; `ui/` must always send it.

- [ ] **Step 1: Failing unit test** — `server/versioned-tests.mjs`

```js
// server/versioned-tests.mjs
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { fileVersion, isStale } from './lib/versioned.mjs';

let passed = 0, failed = 0;
const ok = (c, m) => { if (c) { console.log(`PASS ${m}`); passed++; } else { console.error(`FAIL ${m}`); failed++; } };
const dir = mkdtempSync(join(tmpdir(), 'co-ver-'));
const f = join(dir, 'a.md');
try {
  ok(await fileVersion(f) === null, 'missing file → null');
  writeFileSync(f, 'one');
  const v1 = await fileVersion(f);
  ok(/^[0-9a-f]{40}$/.test(v1), 'version is sha1 hex');
  ok(!(await isStale(f, v1)), 'unchanged file is not stale');
  ok(!(await isStale(f, undefined)), 'no expected version → not stale (legacy client)');
  writeFileSync(f, 'two');
  ok(await isStale(f, v1), 'changed file is stale');
} finally { rmSync(dir, { recursive: true, force: true }); }
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
```

- [ ] **Step 2: Run — expect `ERR_MODULE_NOT_FOUND`**

Run: `node server/versioned-tests.mjs`

- [ ] **Step 3: Implement** — `server/lib/versioned.mjs`

```js
// server/lib/versioned.mjs
// Optimistic concurrency for whole-file writes. Claude Code edits the same
// files while the UI is open; a save carries the version it loaded, and a
// mismatch means someone else wrote in between.
// ponytail: check-then-write is not atomic — the window is milliseconds on a
// single-user machine; a lock would be needed only with concurrent UI writers.
import { createHash } from 'crypto';
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';

export async function fileVersion(abs) {
  if (!existsSync(abs)) return null;
  return createHash('sha1').update(await readFile(abs)).digest('hex');
}

export async function isStale(abs, expected) {
  if (expected === undefined) return false;
  return (await fileVersion(abs)) !== expected;
}
```

- [ ] **Step 4: Wire into `server/routes/setup.mjs`**

Import: `import { fileVersion, isStale } from '../lib/versioned.mjs';`

Add a helper next to `yamlDoc`:

```js
// 409 guard shared by the whole-file writers. Returns true when it responded.
async function rejectIfStale(res, relPath, version) {
  const abs = join(REPO_ROOT, relPath);
  if (!(await isStale(abs, version))) return false;
  sendJson(res, 409, { error: 'changed on disk — reload', currentVersion: await fileVersion(abs) });
  return true;
}
```

- `postCv`: change the destructure to `const { markdown, version } = await readJsonBody(req);` and add after the 400 check: `if (await rejectIfStale(res, 'cv.md', version)) return;`
- `postProfile`: after `const b = await readJsonBody(req);` add `if (await rejectIfStale(res, PROFILE, b.version)) return;`
- `postPortals`: after `const b = await readJsonBody(req);` add `if (await rejectIfStale(res, 'portals.yml', b.version)) return;`
- `getData`: add to the response object:

```js
    versions: {
      cv: await fileVersion(join(REPO_ROOT, 'cv.md')),
      profile: await fileVersion(join(REPO_ROOT, PROFILE)),
      portals: await fileVersion(join(REPO_ROOT, 'portals.yml')),
    },
```

- [ ] **Step 5: Add integration assertions to `server/routes-tests.mjs`** (at the end of the `try`):

```js
  const cvBefore = readFileSync(cvPath, 'utf-8');
  const stale = await jsonPost('/api/setup/cv', { markdown: '# overwritten', version: 'not-the-real-version' });
  ok(stale.status === 409, 'stale cv version → 409');
  ok(readFileSync(cvPath, 'utf-8') === cvBefore, '409 leaves cv.md untouched');
  const { versions } = await (await fetch(`${base}/api/setup/data`)).json();
  ok(typeof versions?.cv === 'string', 'GET /api/setup/data returns versions.cv');
  const fresh = await jsonPost('/api/setup/cv', { markdown: cvBefore, version: versions.cv });
  ok(fresh.status === 200, 'current cv version → 200');
```

- [ ] **Step 6: Run**

Run: `node server/versioned-tests.mjs && node server/routes-tests.mjs`
Expected: `5 passed, 0 failed`; routes-tests all PASS.

- [ ] **Step 7: Commit**

```bash
git add server/lib/versioned.mjs server/versioned-tests.mjs server/routes/setup.mjs server/routes-tests.mjs
git commit -m "feat(server): 409 on stale whole-file writes (cv.md, profile.yml, portals.yml)"
```

---

### Task 5: Scaffold `ui/` and serve it

**Files:**
- Create: `ui/` (Vite react-ts template + Tailwind + shadcn/ui)
- Modify: `server/index.mjs` (`WEB_DIR`), `server/lib/http.mjs` (`TYPES`), `package.json` (scripts), `config/local-paths.txt` (local, gitignored)

**Interfaces:**
- Produces: `npm run ui:dev` (Vite on :5173, proxies `/api` to :3700), `npm run ui:build` (→ `ui/dist/`). Import alias `@/` → `ui/src/`. shadcn components under `ui/src/components/ui/`.
- Produces: the server serves `ui/dist/` when `ui/dist/index.html` exists, else the old `web/`.

- [ ] **Step 1: Create the app** (repo root)

```bash
npm create vite@latest ui -- --template react-ts
```

If it asks to install and start now, answer **No**. Then:

```bash
cd ui && npm install && npm install tailwindcss @tailwindcss/vite react-markdown && npm install -D vitest @types/node
```

- [ ] **Step 2: `ui/vite.config.ts`** — replace the file:

```ts
import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Dev: Vite on :5173 proxies /api to the career-ops server. The server's
// CSRF guard only accepts its own Host/Origin, so the proxy rewrites both.
const API = 'http://127.0.0.1:3700'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  server: {
    proxy: { '/api': { target: API, changeOrigin: true, headers: { origin: API } } },
  },
})
```

- [ ] **Step 3: Path alias for TypeScript/shadcn** — in **both** `ui/tsconfig.json` and `ui/tsconfig.app.json`, add under `compilerOptions` (create the key in `tsconfig.json` if absent):

```json
    "baseUrl": ".",
    "paths": { "@/*": ["./src/*"] }
```

- [ ] **Step 4: Tailwind entry** — replace `ui/src/index.css` with:

```css
@import "tailwindcss";
```

Delete `ui/src/App.css` and its import in `App.tsx`.

- [ ] **Step 5: shadcn/ui**

```bash
cd ui && npx shadcn@latest init
```

Pick the **Neutral** base colour, accept defaults. Then:

```bash
npx shadcn@latest add button badge input select table sheet tabs textarea sonner
```

Expected: files under `ui/src/components/ui/` and `ui/src/lib/utils.ts`.

- [ ] **Step 6: Placeholder `ui/src/App.tsx`** (replaced in Task 7):

```tsx
import { useEffect, useState } from 'react'

export default function App() {
  const [count, setCount] = useState<number | null>(null)
  useEffect(() => {
    fetch('/api/applications').then(r => r.json()).then(d => setCount(d.rows.length))
  }, [])
  return <main className="p-6 text-sm">career-ops UI — {count ?? '…'} tracker rows</main>
}
```

- [ ] **Step 7: Serve `ui/dist` from the server** — `server/index.mjs`:

```js
import { existsSync } from 'fs';
```

```js
// ui/dist (React, built) supersedes the legacy vanilla web/ once it exists.
// The old Setup screen stays reachable at /legacy until M4 replaces it.
const UI_DIST = join(REPO_ROOT, 'ui', 'dist');
const LEGACY_DIR = join(REPO_ROOT, 'web');
const WEB_DIR = existsSync(join(UI_DIST, 'index.html')) ? UI_DIST : LEGACY_DIR;
```

Replace the static-file block at the end of `handle` (the `if (req.method === 'GET') { … }` block) with:

```js
  if (req.method === 'GET') {
    // ponytail: web/index.html loads /style.css and /app.js by absolute path,
    // so misses in ui/dist fall through to web/. Delete with web/ in M4.
    const rel = url.pathname === '/' ? 'index.html'
      : url.pathname === '/legacy' ? null
      : normalize(url.pathname).replace(/^[/\\]+/, '');
    if (rel === null) { if (await serveStatic(res, join(LEGACY_DIR, 'index.html'))) return; }
    else {
      for (const dir of [WEB_DIR, LEGACY_DIR]) {
        const file = join(dir, rel);
        if (file.startsWith(dir) && await serveStatic(res, file)) return;
      }
    }
  }
```

`server/lib/http.mjs` — extend `TYPES`:

```js
const TYPES = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css',
  '.json':'application/json', '.svg':'image/svg+xml', '.md':'text/markdown',
  '.pdf':'application/pdf', '.png':'image/png', '.ico':'image/x-icon', '.woff2':'font/woff2' };
```

- [ ] **Step 8: Root scripts** — `package.json` `"scripts"`:

```json
    "ui:dev": "npm --prefix ui run dev",
    "ui:build": "npm --prefix ui run build",
```

- [ ] **Step 9: Declare `ui/` local** — append to `config/local-paths.txt` (gitignored; this is a local-only change, not committed):

```
# --- React UI (2026-09-28, spec docs/superpowers/specs/2026-09-28-career-ops-ui-v1-design.md)
ui/
```

- [ ] **Step 10: Verify**

Run: `npm run ui:build` → expected `ui/dist/index.html` exists.
Run: `npm run web` in one terminal, then `curl -s http://127.0.0.1:3700/ | grep -c 'id="root"'` → expected `1`.
Run: `node server/routes-tests.mjs` → still all PASS (`GET /` serves HTML).
Open http://127.0.0.1:3700 → "career-ops UI — N tracker rows".
Open http://127.0.0.1:3700/legacy → the old vanilla UI, styled, with its Setup tab working.

- [ ] **Step 11: Commit** (`ui/.gitignore` from the template already excludes `node_modules` and `dist`)

```bash
git add ui package.json server/index.mjs server/lib/http.mjs
git commit -m "feat(ui): scaffold React + Vite + Tailwind + shadcn app; server serves ui/dist"
```

---

## M1 — Applications table + job detail drawer

### Task 6: Detail API — timeline, documents, contacts, JD, apply dates

**Files:**
- Create: `server/lib/detail.mjs`, `server/detail-tests.mjs`, `server/routes/files.mjs`
- Modify: `server/routes/applications.mjs` (`list`, `getOne`), `server/index.mjs` (route), `server/applications-tests.mjs`

**Interfaces:**
- Consumes: `parseContacts(text)` from `contacts.mjs` → `{ contacts: [{ name, company, type, title, phone, email, linkedin, tracker, notes }] }`; `findCaptureForReport(jdsDir, reportNum)` from `jd-capture.mjs` → `{ path, filename } | null`.
- Produces (pure, `server/lib/detail.mjs`):
  - `parseStatusLog(text: string): Array<{ num, date, from, to, source, note }>`
  - `appliedOnByRow(entries): Record<string, string>` — last `to === 'Applied'` date per row
  - `parseFollowUps(text: string, num: string): Array<{ date, kind: 'due'|'sent', detail }>`
  - `reportNumOf(row: Record<string,string>): number | null` — from the Report cell `[NNN](…)`
  - `outputDirFor(reportNum: number, dirNames: string[]): string | null` — first `/^0*N-/` match
- Produces (HTTP):
  - `GET /api/applications` → `{ rows, groups, appliedOn }`
  - `GET /api/applications/:num` → `{ row, report, timeline, documents: { cv, cover }, contacts, jd }` where `timeline` items are `{ date, kind: 'status'|'due'|'sent', detail }` sorted by date ascending; `documents.*` and `jd.url` are `/api/files/...` URLs or `null`.
  - `GET /api/files/output/<path>` and `GET /api/files/jds/<path>` — serve a file strictly inside that directory, else 404.

**Data facts (this install):** `data/status-log.tsv` lines are `{tracker#}\t{date}\t{from}\t{to}\t{source}\t{note}`. `data/follow-ups.md` has a table `| num | appNum | date | company | role | channel | contact | notes |` (sent follow-ups; `appNum` = tracker #) and bullet lines `- next #76 2026-09-07 (set 2026-08-31)` (due dates). Contacts' 8th column is the tracker #. `output/` dirs are `{report#}-{slug}` holding `cv.pdf` / `cover.pdf`. `data/active-interviews.md` does not exist here — interview rounds are deliberately not parsed yet (add when the file exists).

- [ ] **Step 1: Failing unit test** — `server/detail-tests.mjs`

```js
// server/detail-tests.mjs
import { parseStatusLog, appliedOnByRow, parseFollowUps, reportNumOf, outputDirFor } from './lib/detail.mjs';

let passed = 0, failed = 0;
const ok = (c, m) => { if (c) { console.log(`PASS ${m}`); passed++; } else { console.error(`FAIL ${m}`); failed++; } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m);

const log = parseStatusLog('76\t2026-08-31\tEvaluated\tApplied\tset-status\t\n109\t2026-09-02\tEvaluated\tApplied\tweb\t\n109\t2026-09-03\tApplied\tEvaluated\tset-status\toops\n\nbad line\n');
eq(log.length, 3, 'status-log: three well-formed lines, junk skipped');
eq(log[2], { num: '109', date: '2026-09-03', from: 'Applied', to: 'Evaluated', source: 'set-status', note: 'oops' }, 'status-log: fields');
eq(appliedOnByRow(log), { '76': '2026-08-31', '109': '2026-09-02' }, 'appliedOn: last transition INTO Applied per row');

const fu = `# Follow-ups

| num | appNum | date | company | role | channel | contact | notes |
|---|---|---|---|---|---|---|---|
| 1 | 76 | 2026-09-08 | Acme | Dev | email | Jo | nudged |
- next #76 2026-09-15 (set 2026-09-08)
- next #77 2026-09-16 (set 2026-09-08)
`;
eq(parseFollowUps(fu, '76'), [
  { date: '2026-09-08', kind: 'sent', detail: 'email to Jo — nudged' },
  { date: '2026-09-15', kind: 'due', detail: 'follow-up due' },
], 'follow-ups: sent row + due bullet for this row only');

eq(reportNumOf({ Report: '[025](../reports/025-ufinity-2026-08-30.md)' }), 25, 'report number from link');
eq(reportNumOf({ Report: '—' }), null, 'no report link → null');
eq(outputDirFor(25, ['001-persol', '025-ufinity', '250-other']), '025-ufinity', 'output dir by padded prefix');
eq(outputDirFor(7, ['070-x', '007-y']), '007-y', 'prefix match is exact-number, not startsWith');
eq(outputDirFor(9, ['001-a']), null, 'no dir → null');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
```

- [ ] **Step 2: Run — expect `ERR_MODULE_NOT_FOUND`**

Run: `node server/detail-tests.mjs`

- [ ] **Step 3: Implement** — `server/lib/detail.mjs`

```js
// server/lib/detail.mjs
// Pure parsers behind the job detail drawer. Inputs are file contents; the
// route does the I/O. Row numbers stay strings — they are tracker # cells.
import { parseTable } from './markdown-table.mjs';

export function parseStatusLog(text) {
  const out = [];
  for (const line of String(text || '').split('\n')) {
    const c = line.split('\t');
    if (c.length < 5 || !/^\d+$/.test(c[0]) || !/^\d{4}-\d{2}-\d{2}$/.test(c[1])) continue;
    out.push({ num: c[0], date: c[1], from: c[2], to: c[3], source: c[4], note: (c[5] || '').trim() });
  }
  return out;
}

export function appliedOnByRow(entries) {
  const out = {};
  for (const e of entries) if (e.to === 'Applied') out[e.num] = e.date; // later lines win
  return out;
}

export function parseFollowUps(text, num) {
  const out = [];
  for (const r of parseTable(String(text || '')).rows) {
    if (String(r.appNum).trim() !== String(num)) continue;
    const who = r.contact ? ` to ${r.contact}` : '';
    out.push({ date: r.date, kind: 'sent', detail: `${r.channel || 'follow-up'}${who}${r.notes ? ` — ${r.notes}` : ''}` });
  }
  const due = new RegExp(`^- next #${num} (\\d{4}-\\d{2}-\\d{2})\\b`, 'm');
  const m = String(text || '').match(due);
  if (m) out.push({ date: m[1], kind: 'due', detail: 'follow-up due' });
  return out;
}

export function reportNumOf(row) {
  const m = String(row?.Report || '').match(/\[(\d+)\]/);
  return m ? Number(m[1]) : null;
}

export function outputDirFor(reportNum, dirNames) {
  return dirNames.find(d => {
    const m = d.match(/^(\d+)-/);
    return m && Number(m[1]) === reportNum;
  }) ?? null;
}
```

- [ ] **Step 4: Run** — `node server/detail-tests.mjs` → `10 passed, 0 failed`.

- [ ] **Step 5: Files route** — `server/routes/files.mjs`

```js
// server/routes/files.mjs
// Serves generated PDFs (output/) and JD captures (jds/) to the drawer's
// preview iframes. Read-only; the resolved path must stay inside its root.
import { join, relative, isAbsolute } from 'path';
import { REPO_ROOT } from '../lib/paths.mjs';
import { serveStatic, sendJson } from '../lib/http.mjs';

export async function get(req, res, [root, rest]) {
  const base = join(REPO_ROOT, root);
  let abs;
  try { abs = join(base, decodeURIComponent(rest)); } catch { return sendJson(res, 400, { error: 'bad path' }); }
  const rel = relative(base, abs);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return sendJson(res, 404, { error: 'not found' });
  if (!(await serveStatic(res, abs))) sendJson(res, 404, { error: 'not found' });
}
```

In `server/index.mjs`: `import * as files from './routes/files.mjs';` and add to `ROUTES`:

```js
  ['GET',   /^\/api\/files\/(output|jds)\/(.+)$/, files.get],
```

- [ ] **Step 6: Enrich `list` and `getOne`** — `server/routes/applications.mjs`

Add imports:

```js
import { readdir } from 'fs/promises';
import { dirname } from 'path';
import { parseStatusLog, appliedOnByRow, parseFollowUps, reportNumOf, outputDirFor } from '../lib/detail.mjs';
import { parseContacts } from '../../contacts.mjs';
import { findCaptureForReport } from '../../jd-capture.mjs';
```

Add helpers:

```js
const readIf = async abs => (existsSync(abs) ? readFile(abs, 'utf-8') : '');
// status-log.tsv is the tracker's sibling (set-status.mjs writes it there).
const statusLogOf = trackerAbs => readIf(join(dirname(trackerAbs), 'status-log.tsv'));
const fileUrl = (root, rel) => `/api/files/${root}/${rel.split('/').map(encodeURIComponent).join('/')}`;
```

Replace `list`:

```js
export async function list(req, res) {
  const { rows, abs } = await loadTracker();
  const groups = {};
  for (const r of rows) {
    const s = (r['Status'] || '').trim();
    (groups[s] ||= []).push(r);
  }
  const appliedOn = appliedOnByRow(parseStatusLog(await statusLogOf(abs)));
  sendJson(res, 200, { rows, groups, appliedOn });
}
```

Replace `getOne`:

```js
export async function getOne(req, res, [num]) {
  const { rows, abs } = await loadTracker();
  const row = findRowByNum(rows, num);
  if (!row) return sendJson(res, 404, { error: 'not found' });

  let report = null;
  const link = (row['Report'] || '').match(/\(([^)]+\.md)\)/);
  if (link) {
    const rel = link[1].replace(/^\.\.\//, '');
    if (rel.startsWith('reports/')) report = (await readIf(join(REPO_ROOT, rel))) || null;
  }

  const statusTimeline = parseStatusLog(await statusLogOf(abs))
    .filter(e => e.num === String(num))
    .map(e => ({ date: e.date, kind: 'status', detail: `${e.from} → ${e.to}${e.note ? ` (${e.note})` : ''}` }));
  const followUps = parseFollowUps(await readIf(join(REPO_ROOT, 'data/follow-ups.md')), String(num));
  const timeline = [...statusTimeline, ...followUps].sort((a, b) => a.date.localeCompare(b.date));

  const reportNum = reportNumOf(row);
  const documents = { cv: null, cover: null };
  if (reportNum) {
    const outRoot = join(REPO_ROOT, 'output');
    const dirs = existsSync(outRoot) ? await readdir(outRoot) : [];
    const dir = outputDirFor(reportNum, dirs);
    if (dir) {
      for (const k of ['cv', 'cover']) {
        if (existsSync(join(outRoot, dir, `${k}.pdf`))) documents[k] = fileUrl('output', `${dir}/${k}.pdf`);
      }
    }
  }

  const contacts = parseContacts(await readIf(join(REPO_ROOT, 'data/contacts.tsv')))
    .contacts.filter(c => c.tracker === String(num));

  const cap = reportNum ? findCaptureForReport(join(REPO_ROOT, 'jds'), reportNum) : null;
  const jd = cap ? { filename: cap.filename, url: fileUrl('jds', cap.filename) } : null;

  sendJson(res, 200, { row, report, timeline, documents, contacts, jd });
}
```

- [ ] **Step 7: Integration assertions** — in `server/applications-tests.mjs`, append inside `try` (after the Hired assertion):

```js
  const list2 = await (await fetch(`${base}/api/applications`)).json();
  ok(/^\d{4}-\d{2}-\d{2}$/.test(list2.appliedOn?.['2'] ?? ''), 'list returns appliedOn from status-log');
  const d = await (await fetch(`${base}/api/applications/2`)).json();
  ok(d.timeline.some(t => t.kind === 'status' && t.detail === 'Evaluated → Applied'), 'detail timeline has the transition');
  ok(d.documents && 'cv' in d.documents && 'cover' in d.documents, 'detail has documents{cv,cover}');
  ok(Array.isArray(d.contacts), 'detail has contacts[]');
  const trav = await fetch(`${base}/api/files/output/..%2F..%2Fcv.md`);
  ok(trav.status === 404, 'files route blocks path traversal');
```

- [ ] **Step 8: Run**

Run: `node server/detail-tests.mjs && node server/applications-tests.mjs && node server/routes-tests.mjs`
Expected: all PASS. Also, with `npm run web` running: `curl -s http://127.0.0.1:3700/api/applications/1 | head -c 400` shows `timeline`, `documents`, `contacts`, `jd` keys.

- [ ] **Step 9: Commit**

```bash
git add server/lib/detail.mjs server/detail-tests.mjs server/routes/files.mjs server/routes/applications.mjs server/index.mjs server/applications-tests.mjs
git commit -m "feat(server): job detail API — timeline, documents, contacts, JD capture, apply dates"
```

---

### Task 7: Applications table

**Files:**
- Create: `ui/src/lib/api.ts`, `ui/src/lib/rows.ts`, `ui/src/lib/rows.test.ts`, `ui/src/components/ApplicationsTable.tsx`
- Modify: `ui/src/App.tsx`, `ui/package.json` (`"test": "vitest run"`)

**Interfaces:**
- Consumes: `GET /api/applications` → `{ rows: Row[], appliedOn: Record<string,string> }` (Task 6). Row keys are the tracker's header names: `#`, `Date`, `Company`, `Via` (optional), `Role`, `Score`, `Status`, `PDF`, `Report`, `Notes`, `URL` (optional).
- Produces (`ui/src/lib/rows.ts`): `type Row`, `scoreOf(row): number|null`, `type Filter`, `EMPTY_FILTER`, `PRESETS: {label: string; filter: Filter}[]`, `applyFilter(rows, filter, appliedOn, today): Row[]`, `type SortKey = 'num'|'date'|'company'|'score'|'status'`, `sortRows(rows, key, desc): Row[]`, `STATUSES: string[]`.
- Produces: `<ApplicationsTable onOpen={(num: string) => void} refreshKey={number} />`.

- [ ] **Step 1: Failing tests** — `ui/src/lib/rows.test.ts`, and add `"test": "vitest run"` to `ui/package.json` scripts.

```ts
import { describe, expect, it } from 'vitest'
import { applyFilter, EMPTY_FILTER, PRESETS, scoreOf, sortRows, type Row } from './rows'

const row = (o: Partial<Row>): Row => ({ '#': '1', Date: '2026-09-01', Company: 'Acme', Role: 'Dev', Score: '4.2/5', Status: 'Evaluated', Notes: '', ...o })
const today = new Date('2026-09-28T12:00:00')
const rows = [
  row({ '#': '1', Score: '4.2/5', Status: 'Evaluated', Company: 'Acme' }),
  row({ '#': '2', Score: '3.1/5', Status: 'Evaluated', Company: 'Globex' }),
  row({ '#': '3', Score: '3.9/5', Status: 'Applied', Company: 'Initech', Date: '2026-09-01' }),
  row({ '#': '4', Score: 'N/A', Status: 'Interview', Company: 'Umbrella', Role: 'Frontend' }),
]
const nums = (rs: Row[]) => rs.map(r => r['#'])

describe('scoreOf', () => {
  it('parses X.X/5 and rejects sentinels', () => {
    expect(scoreOf(rows[0])).toBe(4.2)
    expect(scoreOf(rows[3])).toBeNull()
  })
})

describe('applyFilter', () => {
  it('free text matches company, role and notes, case-insensitively', () => {
    expect(nums(applyFilter(rows, { ...EMPTY_FILTER, q: 'front' }, {}, today))).toEqual(['4'])
  })
  it('status and min score combine', () => {
    expect(nums(applyFilter(rows, { ...EMPTY_FILTER, statuses: ['Evaluated'], minScore: 4 }, {}, today))).toEqual(['1'])
  })
  it('appliedOlderThan prefers the status-log date over the row date', () => {
    const f = { ...EMPTY_FILTER, statuses: ['Applied'], appliedOlderThan: 14 }
    expect(nums(applyFilter(rows, f, {}, today))).toEqual(['3'])            // row date 27 days ago
    expect(nums(applyFilter(rows, f, { '3': '2026-09-25' }, today))).toEqual([]) // applied 3 days ago
  })
  it('every preset is a valid filter', () => {
    for (const p of PRESETS) expect(Array.isArray(applyFilter(rows, p.filter, {}, today))).toBe(true)
  })
})

describe('sortRows', () => {
  it('sorts by score with unscored rows last in both directions', () => {
    expect(nums(sortRows(rows, 'score', true))).toEqual(['1', '3', '2', '4'])
    expect(nums(sortRows(rows, 'score', false))).toEqual(['2', '3', '1', '4'])
  })
  it('sorts by number numerically', () => {
    expect(nums(sortRows([row({ '#': '10' }), row({ '#': '9' })], 'num', false))).toEqual(['9', '10'])
  })
})
```

- [ ] **Step 2: Run — expect failure** — `cd ui && npm test` → cannot resolve `./rows`.

- [ ] **Step 3: Implement** — `ui/src/lib/rows.ts`

```ts
export type Row = Record<string, string>

export const STATUSES = ['Evaluated', 'Applied', 'Responded', 'Interview', 'Offer', 'Hired', 'Rejected', 'Discarded', 'SKIP']

export function scoreOf(r: Row): number | null {
  const m = /^(\d+(?:\.\d+)?)\/5/.exec((r.Score ?? '').trim())
  return m ? Number(m[1]) : null
}

export type Filter = { q: string; statuses: string[]; minScore: number | null; appliedOlderThan: number | null }
export const EMPTY_FILTER: Filter = { q: '', statuses: [], minScore: null, appliedOlderThan: null }

// ponytail: fixed presets, not user-saved filters — add persistence when a
// fourth one is actually wanted.
export const PRESETS: { label: string; filter: Filter }[] = [
  { label: 'Worth applying (≥ 4.0)', filter: { ...EMPTY_FILTER, statuses: ['Evaluated'], minScore: 4 } },
  { label: 'Applied > 14 days', filter: { ...EMPTY_FILTER, statuses: ['Applied'], appliedOlderThan: 14 } },
  { label: 'Live', filter: { ...EMPTY_FILTER, statuses: ['Applied', 'Responded', 'Interview', 'Offer'] } },
]

const DAY = 86_400_000
const daysSince = (iso: string, today: Date) => Math.floor((today.getTime() - new Date(`${iso}T00:00:00`).getTime()) / DAY)

export function applyFilter(rows: Row[], f: Filter, appliedOn: Record<string, string>, today = new Date()): Row[] {
  const q = f.q.trim().toLowerCase()
  return rows.filter(r => {
    if (f.statuses.length && !f.statuses.includes(r.Status)) return false
    if (f.minScore !== null && (scoreOf(r) ?? -1) < f.minScore) return false
    if (f.appliedOlderThan !== null) {
      const when = appliedOn[r['#']] ?? r.Date // rows applied before the ledger existed fall back to the row date
      if (!when || daysSince(when, today) <= f.appliedOlderThan) return false
    }
    if (q && ![r.Company, r.Role, r.Notes, r.Via].some(v => v?.toLowerCase().includes(q))) return false
    return true
  })
}

export type SortKey = 'num' | 'date' | 'company' | 'score' | 'status'

export function sortRows(rows: Row[], key: SortKey, desc: boolean): Row[] {
  const dir = desc ? -1 : 1
  return [...rows].sort((a, b) => {
    if (key === 'score') {
      const sa = scoreOf(a), sb = scoreOf(b)
      if (sa === null || sb === null) return sa === sb ? 0 : sa === null ? 1 : -1 // unscored always last
      return (sa - sb) * dir
    }
    if (key === 'num') return (Number(a['#']) - Number(b['#'])) * dir
    if (key === 'status') return (STATUSES.indexOf(a.Status) - STATUSES.indexOf(b.Status)) * dir
    const field = key === 'date' ? 'Date' : 'Company'
    return (a[field] ?? '').localeCompare(b[field] ?? '') * dir
  })
}
```

- [ ] **Step 4: Run** — `cd ui && npm test` → all PASS.

- [ ] **Step 5: API client** — `ui/src/lib/api.ts`

```ts
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
```

(Same-origin `fetch` sends `Origin` on PATCH automatically — no header needed.)

- [ ] **Step 6: Table component** — `ui/src/components/ApplicationsTable.tsx`

```tsx
import { useEffect, useMemo, useState } from 'react'
import { getApplications, type ListResponse } from '@/lib/api'
import { applyFilter, EMPTY_FILTER, PRESETS, scoreOf, sortRows, STATUSES, type Filter, type SortKey } from '@/lib/rows'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

const COLS: { key: SortKey; label: string }[] = [
  { key: 'num', label: '#' }, { key: 'date', label: 'Date' }, { key: 'company', label: 'Company' },
  { key: 'score', label: 'Score' }, { key: 'status', label: 'Status' },
]

export function ApplicationsTable({ onOpen, refreshKey }: { onOpen: (num: string) => void; refreshKey: number }) {
  const [data, setData] = useState<ListResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>(EMPTY_FILTER)
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'num', desc: true })

  useEffect(() => { getApplications().then(setData, e => setError(e.message)) }, [refreshKey])

  const shown = useMemo(() => {
    if (!data) return []
    return sortRows(applyFilter(data.rows, filter, data.appliedOn), sort.key, sort.desc)
  }, [data, filter, sort])

  if (error) return <p className="p-6 text-sm text-red-600">Could not load the tracker: {error}</p>
  if (!data) return <p className="p-6 text-sm text-muted-foreground">Loading…</p>

  const toggleStatus = (s: string) => setFilter(f => ({
    ...f, statuses: f.statuses.includes(s) ? f.statuses.filter(x => x !== s) : [...f.statuses, s],
  }))

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input className="w-64" placeholder="Search company, role, notes…" value={filter.q}
          onChange={e => setFilter(f => ({ ...f, q: e.target.value }))} />
        {PRESETS.map(p => (
          <Button key={p.label} size="sm" variant="outline" onClick={() => setFilter(p.filter)}>{p.label}</Button>
        ))}
        <Button size="sm" variant="ghost" onClick={() => setFilter(EMPTY_FILTER)}>Clear</Button>
        <span className="ml-auto text-sm text-muted-foreground">{shown.length} of {data.rows.length}</span>
      </div>
      <div className="flex flex-wrap gap-1">
        {STATUSES.map(s => (
          <Badge key={s} className="cursor-pointer select-none" variant={filter.statuses.includes(s) ? 'default' : 'outline'}
            onClick={() => toggleStatus(s)}>{s}</Badge>
        ))}
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            {COLS.map(c => (
              <TableHead key={c.key} className="cursor-pointer select-none"
                onClick={() => setSort(s => ({ key: c.key, desc: s.key === c.key ? !s.desc : true }))}>
                {c.label}{sort.key === c.key ? (sort.desc ? ' ↓' : ' ↑') : ''}
              </TableHead>
            ))}
            <TableHead>Role</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {shown.map(r => (
            <TableRow key={r['#']} className="cursor-pointer" onClick={() => onOpen(r['#'])}>
              <TableCell className="tabular-nums text-muted-foreground">{r['#']}</TableCell>
              <TableCell className="tabular-nums">{r.Date}</TableCell>
              <TableCell className="font-medium">{r.Company}{r.Via ? <span className="text-muted-foreground"> via {r.Via}</span> : null}</TableCell>
              <TableCell className="tabular-nums">{scoreOf(r)?.toFixed(1) ?? '—'}</TableCell>
              <TableCell><Badge variant="secondary">{r.Status}</Badge></TableCell>
              <TableCell className="max-w-md truncate">{r.Role}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
```

- [ ] **Step 7: Mount it** — `ui/src/App.tsx`

```tsx
import { useState } from 'react'
import { ApplicationsTable } from '@/components/ApplicationsTable'

export default function App() {
  const [openNum, setOpenNum] = useState<string | null>(null)
  const [refreshKey] = useState(0)
  return (
    <main className="mx-auto max-w-6xl p-6">
      <h1 className="mb-4 text-xl font-semibold">Applications</h1>
      <ApplicationsTable onOpen={setOpenNum} refreshKey={refreshKey} />
      {openNum && <p className="sr-only">selected #{openNum}</p>}
    </main>
  )
}
```

(`openNum` and `refreshKey` are wired to the drawer in Task 8.)

- [ ] **Step 8: Verify in the browser** — `npm run web` and `npm run ui:dev`, open http://localhost:5173.
Expected: ~400 rows; typing "google" narrows the list; "Worth applying (≥ 4.0)" shows only Evaluated rows with score ≥ 4.0; clicking "Score" toggles ↓/↑ with unscored rows at the bottom.

- [ ] **Step 9: Commit**

```bash
git add ui/src/lib ui/src/components/ApplicationsTable.tsx ui/src/App.tsx ui/package.json
git commit -m "feat(ui): applications table with search, status/score filters, presets and sorting"
```

---

### Task 8: Job detail drawer (read-only)

**Files:**
- Create: `ui/src/components/JobDrawer.tsx`, `ui/src/lib/report.ts`, `ui/src/lib/report.test.ts`
- Modify: `ui/src/App.tsx`

**Interfaces:**
- Consumes: `getApplication(num)` → `Detail` (Task 7 `api.ts`).
- Produces: `splitReport(md: string): { title: string; body: string }[]` — splits on `## ` headings; `<JobDrawer num={string|null} onClose={() => void} onChanged={() => void} />` (`onChanged` is used in Task 9).

- [ ] **Step 1: Failing test** — `ui/src/lib/report.test.ts`

```ts
import { expect, it } from 'vitest'
import { splitReport } from './report'

it('splits a report into its ## sections, keeping the preamble', () => {
  const md = '# Acme — Dev\n**Score:** 4.2/5\n\n## A) Role Summary\nfoo\n\n## Machine Summary\n```yaml\nx: 1\n```\n'
  const s = splitReport(md)
  expect(s.map(x => x.title)).toEqual(['Overview', 'A) Role Summary', 'Machine Summary'])
  expect(s[0].body).toContain('**Score:** 4.2/5')
  expect(s[2].body).toContain('x: 1')
})

it('ignores ## inside fenced code blocks', () => {
  const s = splitReport('intro\n```\n## not a heading\n```\n## Real\nbody')
  expect(s.map(x => x.title)).toEqual(['Overview', 'Real'])
})
```

- [ ] **Step 2: Run — expect failure** — `cd ui && npm test`.

- [ ] **Step 3: Implement** — `ui/src/lib/report.ts`

```ts
// Evaluation reports are Blocks A–G + Machine Summary as `## ` sections; the
// drawer shows each as a collapsible <details>.
export function splitReport(md: string): { title: string; body: string }[] {
  const out = [{ title: 'Overview', body: '' }]
  let fenced = false
  for (const line of md.split('\n')) {
    if (line.startsWith('```')) fenced = !fenced
    const h = !fenced && /^## (.+)$/.exec(line)
    if (h) out.push({ title: h[1].trim(), body: '' })
    else out[out.length - 1].body += line + '\n'
  }
  return out.filter((s, i) => i > 0 || s.body.trim())
}
```

- [ ] **Step 4: Run** — `cd ui && npm test` → PASS.

- [ ] **Step 5: Drawer** — `ui/src/components/JobDrawer.tsx`

```tsx
import { useEffect, useState } from 'react'
import Markdown from 'react-markdown'
import { getApplication, type Detail } from '@/lib/api'
import { splitReport } from '@/lib/report'
import { scoreOf } from '@/lib/rows'
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
                {url && <a className="underline" href={url} target="_blank" rel="noreferrer">posting ↗</a>}
              </SheetDescription>
            </SheetHeader>

            {/* Status + notes editing lands here in Task 9 (StatusEditor). */}
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
```

`onChanged` and `setReloadKey` are unused until Task 9, which wires both. The Vite template's `noUnusedLocals`/`noUnusedParameters` will fail `npm run ui:build` in between — so verify Task 8 with `npm run ui:dev` only (the dev server does not type-check) and run the first build in Task 9 Step 5.

- [ ] **Step 6: Mount** — `ui/src/App.tsx`

```tsx
import { useState } from 'react'
import { ApplicationsTable } from '@/components/ApplicationsTable'
import { JobDrawer } from '@/components/JobDrawer'

export default function App() {
  const [openNum, setOpenNum] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  return (
    <main className="mx-auto max-w-6xl p-6">
      <h1 className="mb-4 text-xl font-semibold">Applications</h1>
      <ApplicationsTable onOpen={setOpenNum} refreshKey={refreshKey} />
      <JobDrawer num={openNum} onClose={() => setOpenNum(null)} onChanged={() => setRefreshKey(k => k + 1)} />
    </main>
  )
}
```

- [ ] **Step 7: Verify in the browser** (`npm run web` + `npm run ui:dev`):
  - Click row for UFINITY (report 025) → drawer shows CV and Cover letter tabs rendering the PDFs.
  - Click an Evaluated row with no output dir → "No tailored CV yet" + copyable `/career-ops pdf NNN`.
  - An Applied row with a status-log entry shows `Evaluated → Applied` with its date; a row in `data/follow-ups.md` shows ⏰ due date.
  - Merquri (row 205) lists its recruiter contact; a row with none shows the ⚠ warning.
  - Report sections collapse/expand; the first is open.

- [ ] **Step 8: Commit**

```bash
git add ui/src/components/JobDrawer.tsx ui/src/lib/report.ts ui/src/lib/report.test.ts ui/src/App.tsx
git commit -m "feat(ui): job detail drawer — timeline, PDF previews, contacts, JD, report sections"
```

---

### Task 9: Status and note editing in the drawer

**Files:**
- Create: `ui/src/components/StatusEditor.tsx`
- Modify: `ui/src/components/JobDrawer.tsx`, `ui/src/main.tsx` (mount `<Toaster />`)

**Interfaces:**
- Consumes: `patchApplication(num, { status?, note? })` (Task 7) — errors carry set-status's message (e.g. `Unknown state "X"`, lock busy).
- Produces: `<StatusEditor num={string} status={string} onSaved={() => void} />`.

- [ ] **Step 1: Component** — `ui/src/components/StatusEditor.tsx`

```tsx
import { useState } from 'react'
import { toast } from 'sonner'
import { patchApplication } from '@/lib/api'
import { STATUSES } from '@/lib/rows'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

// Status goes through set-status.mjs (validated, locked, logged to
// status-log.tsv). The note box sends ONLY the new text — set-status appends
// it; re-sending the existing note would duplicate it.
export function StatusEditor({ num, status, onSaved }: { num: string; status: string; onSaved: () => void }) {
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')

  async function save(body: { status?: string; note?: string }, done: string) {
    setBusy(true)
    try {
      await patchApplication(num, body)
      toast.success(done)
      onSaved()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold">Status</span>
        <Select value={status} disabled={busy} onValueChange={s => s !== status && save({ status: s }, `Status → ${s}`)}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>{STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Textarea placeholder="Add a note (appended to the existing notes)" value={note} disabled={busy}
          onChange={e => setNote(e.target.value)} />
        <Button size="sm" disabled={busy || !note.trim()}
          onClick={() => save({ note: note.trim() }, 'Note added').then(() => setNote(''))}>Add note</Button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Use it in the drawer** — in `JobDrawer.tsx`, import `StatusEditor` and replace the `{/* Status + notes editing … */}` comment and the `Notes:` paragraph with:

```tsx
            <StatusEditor num={d.row['#']} status={d.row.Status}
              onSaved={() => { setReloadKey(k => k + 1); onChanged() }} />
            <p className="text-sm text-muted-foreground">Notes: {d.row.Notes || '—'}</p>
```

- [ ] **Step 3: Mount the toaster** — `ui/src/main.tsx`: `import { Toaster } from '@/components/ui/sonner'` and render `<Toaster />` next to `<App />` inside `StrictMode`.

- [ ] **Step 4: Verify against a throwaway tracker** (never your real one):

```bash
cp data/applications.md "$TMPDIR/apps-ui-test.md"
CAREER_OPS_TRACKER="$TMPDIR/apps-ui-test.md" npm run web
```

In another terminal `npm run ui:dev`, open http://localhost:5173, then:
  - Change a row Evaluated → Applied: success toast; drawer and table update; `tail -1 "$TMPDIR/status-log.tsv"` shows `…\tEvaluated\tApplied\tweb\t`.
  - Add note "ui test": the Notes line ends with `; ui test`; adding it again leaves it unchanged (set-status is idempotent).
  - Compare with the CLI: `CAREER_OPS_TRACKER="$TMPDIR/apps-ui-test.md" node set-status.mjs --row <N> Responded --json` produces the same kind of row change and log line (source `set-status` instead of `web`).
  - Stop the server mid-session and change a status: an error toast, no crash.

Then `rm "$TMPDIR/apps-ui-test.md" "$TMPDIR/status-log.tsv"`.

- [ ] **Step 5: Build + full server suite**

Run: `npm run ui:build && cd ui && npm test && cd .. && npm run test:server`
Expected: build succeeds; vitest all PASS; every `server/*-tests.mjs` PASS.

- [ ] **Step 6: Commit**

```bash
git add ui/src/components/StatusEditor.tsx ui/src/components/JobDrawer.tsx ui/src/main.tsx
git commit -m "feat(ui): change status and append notes from the drawer via set-status"
```

---

## Deliberately not in this plan

- **Kanban, Today, Stats** — M2.
- **CV/cover editor** — M3; its three open questions (spec §7) must be answered first.
- **Preferences editors, stale-CV flags, deleting `web/`** — M4. Until then the old Setup screen lives at `/legacy` (Task 5 Step 7); M4 deletes `web/`, `LEGACY_DIR` and the fall-through.
- **Interview rounds in the timeline** — `data/active-interviews.md` doesn't exist in this install; parse it when it does.
- **Machine Summary as chips** — shown as a collapsible YAML block for now.
- **User-saved filters** — three fixed presets instead.
- **TanStack Table / virtualization** — 400 rows sort and filter fine with `useMemo`.
