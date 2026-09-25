# Resume Upload & Auto-Extract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user upload a PDF or `.docx` resume on the Setup tab; the server extracts the text into `cv.md` and pre-fills the reliably-detectable profile fields (email, phone, LinkedIn, GitHub, name) for review.

**Architecture:** A new `POST /api/setup/cv/upload` route reads the raw file bytes, dispatches by extension to `pdf-parse` (PDF) or `mammoth` (`.docx`) for deterministic text extraction, writes `cv.md`, and returns the text + regex-extracted contact fields. The frontend fills the existing onboarding form from the response; the existing Save buttons still perform the final writes. No LLM, no API key. Builds on the Phase-1 web UI (branch `feat/web-ui-phase1`).

**Tech Stack:** Node ESM, built-in `http`, existing server libs, plain HTML/JS frontend, two new pure-JS deps: `pdf-parse`, `mammoth`. Tests follow the repo's `*-tests.mjs` PASS/FAIL-counter idiom, registered in `test-all.mjs`.

## Global Constraints

- **New deps allowed for this feature only:** `pdf-parse` and `mammoth`. No others (no multipart parser — uploads are raw bytes).
- **Only `cv.md` is written by the upload route**, always via `resolveUserPath('cv.md')` + `atomicWrite`. No other path.
- **Body size:** uploads reuse the 8 MB cap (`readRawBody` mirrors `readJsonBody`).
- **Formats:** `.pdf` and `.docx` only. Anything else → 400 `UNSUPPORTED_FORMAT`. Empty/blank extracted text → 400 `EMPTY_EXTRACTION`. The paste box remains the fallback.
- **`extractFields` is a pure function** (no I/O), each field independent, never throws, `''` when not found.
- **Test idiom:** standalone `server/<name>-tests.mjs` printing `PASS`/`FAIL`, exit `0` all-pass / `1` on any failure; registered in `test-all.mjs` with `expectExit: 0`.
- **pdf-parse import:** import the library entry directly as `import pdfParse from 'pdf-parse/lib/pdf-parse.js'` to avoid the package index's debug-mode test-file read.
- **Server stays LLM-free / offline** in the extraction path.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `server/lib/resume-fields.mjs` | Pure regex/heuristic extraction of `{email,phone,linkedin,github,name}` from text. |
| `server/lib/resume-extract.mjs` | `extractText(buffer, filename)` — dispatch to pdf-parse/mammoth; typed errors. |
| `server/lib/http.mjs` (modify) | add `readRawBody(req)` → `Buffer` with the 8 MB cap. |
| `server/routes/setup.mjs` (modify) | add `postCvUpload`; extend `postProfile` to persist phone/linkedin/github. |
| `server/index.mjs` (modify) | register the upload route. |
| `web/index.html`, `web/app.js`, `web/style.css` (modify) | file input + upload handler + 3 new profile inputs + prefill. |
| `server/fixtures/sample.pdf`, `server/fixtures/sample.docx` | committed test fixtures with known text. |
| `server/resume-fields-tests.mjs`, `server/http-tests.mjs`, `server/resume-extract-tests.mjs` | tests. |
| `test-all.mjs` (modify), `docs/WEB_UI.md` (modify) | register tests; document upload. |

---

## Task 1: Pure contact-field extraction

**Files:**
- Create: `server/lib/resume-fields.mjs`
- Test: `server/resume-fields-tests.mjs`

**Interfaces:**
- Produces: `extractFields(text: string) -> { email, phone, linkedin, github, name }` (all strings, `''` if absent). Pure, never throws.

- [ ] **Step 1: Write the failing test**

```js
// server/resume-fields-tests.mjs
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const HERE = dirname(fileURLToPath(import.meta.url));
let passed = 0, failed = 0;
const pass = m => { console.log(`PASS ${m}`); passed++; };
const fail = m => { console.error(`FAIL ${m}`); failed++; };
const eq = (a, b, m) => a === b ? pass(m) : fail(`${m} :: got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);

const { extractFields } = await import(join(HERE, 'lib/resume-fields.mjs'));

const full = `Jane Tester
jane@example.com
+1 555 0100
linkedin.com/in/janetester
github.com/janetester
Senior Engineer with 10 years experience.`;
const f = extractFields(full);
eq(f.email, 'jane@example.com', 'extracts email');
eq(f.phone, '+1 555 0100', 'extracts phone');
eq(f.linkedin, 'linkedin.com/in/janetester', 'extracts linkedin');
eq(f.github, 'github.com/janetester', 'extracts github');
eq(f.name, 'Jane Tester', 'guesses name from first line');

const sparse = `Contact: a@b.com or c@d.com
No number on this line.`;
const s = extractFields(sparse);
eq(s.email, 'a@b.com', 'picks the first of multiple emails');
eq(s.phone, '', 'no phone → empty');
eq(s.linkedin, '', 'no linkedin → empty');
eq(s.name, '', 'no confident name → empty');

eq(extractFields('').email, '', 'empty input is safe');
eq(extractFields(null).name, '', 'null input is safe');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node server/resume-fields-tests.mjs`
Expected: FAIL — `Cannot find module .../lib/resume-fields.mjs`.

- [ ] **Step 3: Write minimal implementation**

```js
// server/lib/resume-fields.mjs
// Pure heuristic extraction of contact fields from resume plain text.

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const PHONE = /\+?\d[\d\s().-]{5,}\d/;
const LINKEDIN = /(?:https?:\/\/)?(?:www\.)?linkedin\.com\/[^\s)]+/i;
const GITHUB = /(?:https?:\/\/)?(?:www\.)?github\.com\/[^\s)]+/i;

function firstMatch(re, text) { const m = text.match(re); return m ? m[0].trim() : ''; }

function guessName(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  for (const line of lines.slice(0, 5)) {
    if (line.includes('@') || /\d/.test(line)) continue;
    const words = line.split(/\s+/);
    if (words.length >= 2 && words.length <= 4 && words.every(w => /^[A-Z][a-zA-Z.'-]*$/.test(w))) {
      return line;
    }
  }
  return '';
}

export function extractFields(text) {
  const t = String(text ?? '');
  let phone = '';
  const pm = t.match(PHONE);
  if (pm) {
    const digits = pm[0].replace(/\D/g, '');
    if (digits.length >= 7 && digits.length <= 15) phone = pm[0].trim();
  }
  return {
    email: firstMatch(EMAIL, t),
    phone,
    linkedin: firstMatch(LINKEDIN, t),
    github: firstMatch(GITHUB, t),
    name: guessName(t),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node server/resume-fields-tests.mjs`
Expected: PASS — `11 passed, 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add server/lib/resume-fields.mjs server/resume-fields-tests.mjs
git commit -m "feat(web): add pure resume contact-field extractor"
```

---

## Task 2: `readRawBody` helper

**Files:**
- Modify: `server/lib/http.mjs` (add export after `readJsonBody`, around line 25)
- Test: `server/http-tests.mjs`

**Interfaces:**
- Produces: `readRawBody(req) -> Promise<Buffer>` — concatenates request chunks into a Buffer; rejects `Error('payload too large (>8MB)')` past 8 MB; single-settle guard like `readJsonBody`.

- [ ] **Step 1: Write the failing test**

```js
// server/http-tests.mjs
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { Readable } from 'stream';
const HERE = dirname(fileURLToPath(import.meta.url));
let passed = 0, failed = 0;
const pass = m => { console.log(`PASS ${m}`); passed++; };
const fail = m => { console.error(`FAIL ${m}`); failed++; };
const ok = (c, m) => c ? pass(m) : fail(m);

const { readRawBody } = await import(join(HERE, 'lib/http.mjs'));

function mkReq(chunks) { const r = Readable.from(chunks); r.destroy = () => r.emit('close'); return r; }

const buf = await readRawBody(mkReq([Buffer.from('hello '), Buffer.from('world')]));
ok(Buffer.isBuffer(buf), 'returns a Buffer');
ok(buf.toString() === 'hello world', 'concatenates chunks in order');

const empty = await readRawBody(mkReq([]));
ok(empty.length === 0, 'empty body → empty Buffer');

let threw = false;
try { await readRawBody(mkReq([Buffer.alloc(9_000_000)])); } catch { threw = true; }
ok(threw, 'oversize (>8MB) rejects');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node server/http-tests.mjs`
Expected: FAIL — `readRawBody is not a function`.

- [ ] **Step 3: Add the implementation**

Insert this export into `server/lib/http.mjs` immediately after the `readJsonBody` function (after line 25, before `sendJson`):

```js
export function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let done = false;
    const finish = (fn, val) => { if (!done) { done = true; fn(val); } };
    req.on('data', c => {
      if (done) return;
      size += c.length;
      if (size > 8e6) { req.destroy(); finish(reject, new Error('payload too large (>8MB)')); return; }
      chunks.push(Buffer.from(c));
    });
    req.on('end', () => finish(resolve, Buffer.concat(chunks)));
    req.on('error', e => finish(reject, e));
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node server/http-tests.mjs`
Expected: PASS — `4 passed, 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add server/lib/http.mjs server/http-tests.mjs
git commit -m "feat(web): add readRawBody for binary uploads"
```

---

## Task 3: Text extraction (pdf-parse + mammoth) with fixtures

**Files:**
- Modify: `package.json` (add deps)
- Create: `server/lib/resume-extract.mjs`
- Create: `server/fixtures/sample.docx`, `server/fixtures/sample.pdf` (committed binaries)
- Test: `server/resume-extract-tests.mjs`

**Interfaces:**
- Consumes: `pdf-parse`, `mammoth`.
- Produces: `extractText(buffer: Buffer, filename: string) -> Promise<string>`. Throws `Error` with `.code === 'UNSUPPORTED_FORMAT'` (non pdf/docx) or `.code === 'EMPTY_EXTRACTION'` (blank result).

- [ ] **Step 1: Install the dependencies**

Run (the `--ignore-scripts` avoids re-triggering the project's playwright postinstall):

```bash
npm install --ignore-scripts pdf-parse mammoth
```

Verify they're in `package.json` `dependencies`:
Run: `node -e "const d=require('./package.json').dependencies; console.log(d['pdf-parse']?'pdf-parse ok':'MISSING', d.mammoth?'mammoth ok':'MISSING')"`
Expected: `pdf-parse ok mammoth ok`.

- [ ] **Step 2: Create the test fixtures (committed binaries with known text)**

The fixtures must contain the exact strings `Jane Tester` and `jane@example.com`. Generate them on this machine and commit the binaries (the test only reads them, so CI stays portable).

```bash
mkdir -p server/fixtures
printf 'Jane Tester\njane@example.com\n+1 555 0100\nlinkedin.com/in/janetester\ngithub.com/janetester\nSenior Engineer.\n' > /tmp/resume.txt
# DOCX via macOS textutil (this machine is darwin):
textutil -convert docx -output server/fixtures/sample.docx /tmp/resume.txt
# PDF via the already-installed Playwright (text-based, extractable):
node -e "const {chromium}=require('playwright');(async()=>{const b=await chromium.launch();const p=await b.newPage();await p.setContent('<pre>Jane Tester\njane@example.com\n+1 555 0100\nlinkedin.com/in/janetester\ngithub.com/janetester\nSenior Engineer.</pre>');await p.pdf({path:'server/fixtures/sample.pdf'});await b.close();})()"
```

Verify both exist and are non-empty:
Run: `ls -l server/fixtures/sample.docx server/fixtures/sample.pdf`
Expected: both files present, > 0 bytes.

If `textutil` is unavailable in your environment, create `server/fixtures/sample.docx` with any tool (LibreOffice `soffice --headless --convert-to docx`, python-docx, or an online editor) containing the same two strings, and commit it.

- [ ] **Step 3: Write the failing test**

```js
// server/resume-extract-tests.mjs
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync } from 'fs';
const HERE = dirname(fileURLToPath(import.meta.url));
let passed = 0, failed = 0;
const pass = m => { console.log(`PASS ${m}`); passed++; };
const fail = m => { console.error(`FAIL ${m}`); failed++; };
const ok = (c, m) => c ? pass(m) : fail(m);

const { extractText } = await import(join(HERE, 'lib/resume-extract.mjs'));

const docx = readFileSync(join(HERE, 'fixtures/sample.docx'));
const pdf = readFileSync(join(HERE, 'fixtures/sample.pdf'));

const docxText = await extractText(docx, 'resume.docx');
ok(docxText.includes('Jane Tester'), 'docx: extracts name text');
ok(docxText.includes('jane@example.com'), 'docx: extracts email text');

const pdfText = await extractText(pdf, 'resume.pdf');
ok(pdfText.includes('Jane Tester'), 'pdf: extracts name text');
ok(pdfText.includes('jane@example.com'), 'pdf: extracts email text');

let code = '';
try { await extractText(Buffer.from('hi'), 'notes.txt'); } catch (e) { code = e.code; }
ok(code === 'UNSUPPORTED_FORMAT', 'unsupported extension throws UNSUPPORTED_FORMAT');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
```

- [ ] **Step 4: Run test to verify it fails**

Run: `node server/resume-extract-tests.mjs`
Expected: FAIL — `Cannot find module .../lib/resume-extract.mjs`.

- [ ] **Step 5: Write the implementation**

```js
// server/lib/resume-extract.mjs
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import mammoth from 'mammoth';
import { extname } from 'path';

export async function extractText(buffer, filename) {
  const ext = extname(String(filename || '').toLowerCase());
  let text;
  if (ext === '.pdf') {
    const data = await pdfParse(buffer);
    text = data.text;
  } else if (ext === '.docx') {
    const { value } = await mammoth.extractRawText({ buffer });
    text = value;
  } else {
    const err = new Error(`unsupported format: ${ext || '(none)'}`);
    err.code = 'UNSUPPORTED_FORMAT';
    throw err;
  }
  if (!text || !text.trim()) {
    const err = new Error('no text extracted');
    err.code = 'EMPTY_EXTRACTION';
    throw err;
  }
  return text;
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `node server/resume-extract-tests.mjs`
Expected: PASS — `5 passed, 0 failed`.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json server/lib/resume-extract.mjs server/resume-extract-tests.mjs server/fixtures/sample.docx server/fixtures/sample.pdf
git commit -m "feat(web): add PDF/DOCX text extraction with fixtures"
```

---

## Task 4: Upload route + profile field persistence + integration assertion

**Files:**
- Modify: `server/routes/setup.mjs` (add `postCvUpload`; extend `postProfile`)
- Modify: `server/index.mjs` (register route)
- Modify: `server/routes-tests.mjs` (add upload assertion with cleanup)

**Interfaces:**
- Consumes: `readRawBody` (http.mjs), `extractText` (resume-extract.mjs), `extractFields` (resume-fields.mjs), `resolveUserPath`, `atomicWrite`, `sendJson`.
- Produces: `postCvUpload(req, res)` → `200 { ok:true, cvText, fields }`; 400 on UNSUPPORTED_FORMAT / EMPTY_EXTRACTION. `postProfile` additionally persists `phone`, `linkedin`, `github` when present in the body.

- [ ] **Step 1: Add the upload integration assertion to `server/routes-tests.mjs`**

Inside the existing `try { ... }` block (after the current assertions, before the `finally`), add an upload round-trip that cleans up `cv.md` if it created it. Insert at the top of the test file's imports: `import { existsSync, unlinkSync, readFileSync } from 'fs';` (merge with any existing fs import). Then add:

```js
  // Resume upload: post the docx fixture as raw bytes, expect extracted fields back.
  const hadCv = existsSync(join(ROOT, 'cv.md'));
  const docxBytes = readFileSync(join(ROOT, 'server/fixtures/sample.docx'));
  const up = await fetch(`${base}/api/setup/cv/upload?filename=resume.docx`, { method: 'POST', body: docxBytes });
  const upBody = await up.json();
  ok(up.status === 200, 'POST /api/setup/cv/upload returns 200');
  ok(upBody.fields && upBody.fields.email === 'jane@example.com', 'upload returns extracted email');
  ok(typeof upBody.cvText === 'string' && upBody.cvText.includes('Jane Tester'), 'upload returns cvText');
  if (!hadCv && existsSync(join(ROOT, 'cv.md'))) unlinkSync(join(ROOT, 'cv.md')); // don't pollute onboarding state

  const bad = await fetch(`${base}/api/setup/cv/upload?filename=notes.txt`, { method: 'POST', body: 'x' });
  ok(bad.status === 400, 'unsupported upload → 400');
```

(`ROOT` and `base` already exist in this test.)

- [ ] **Step 2: Run test to verify it fails**

Run: `node server/routes-tests.mjs`
Expected: FAIL — the upload returns 404/500 (route not registered yet) so the new assertions fail.

- [ ] **Step 3: Add `postCvUpload` and extend `postProfile` in `server/routes/setup.mjs`**

Update the http import (line 6) to include `readRawBody`, and add the two new imports below the existing imports:

```js
import { readJsonBody, readRawBody, sendJson, atomicWrite } from '../lib/http.mjs';
import { extractText } from '../lib/resume-extract.mjs';
import { extractFields } from '../lib/resume-fields.mjs';
```

In `postProfile`, after the existing `profile.candidate.location = ...` line (line 29), add persistence for the new fields:

```js
  if (b.phone) profile.candidate.phone = b.phone;
  if (b.linkedin) profile.candidate.linkedin = b.linkedin;
  if (b.github) profile.candidate.github = b.github;
```

Add the new handler at the end of the file:

```js
export async function postCvUpload(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const filename = url.searchParams.get('filename') || '';
  const buffer = await readRawBody(req);
  let text;
  try {
    text = await extractText(buffer, filename);
  } catch (e) {
    if (e.code === 'UNSUPPORTED_FORMAT') return sendJson(res, 400, { error: 'Unsupported file — upload a PDF or .docx' });
    if (e.code === 'EMPTY_EXTRACTION') return sendJson(res, 400, { error: "Couldn't read text — the file may be image-only; paste your CV instead." });
    throw e; // dispatcher → 500
  }
  await atomicWrite(resolveUserPath('cv.md'), text);
  sendJson(res, 200, { ok: true, cvText: text, fields: extractFields(text) });
}
```

- [ ] **Step 4: Register the route in `server/index.mjs`**

Add this line to the `ROUTES` array immediately after the `setup.postCv` entry (the patterns are anchored, so order is not significant — placement is for readability):

```js
  ['POST',  /^\/api\/setup\/cv\/upload$/,    setup.postCvUpload],
```

- [ ] **Step 5: Run the integration test to verify it passes**

Run: `node server/routes-tests.mjs`
Expected: PASS — all assertions pass including the two new upload ones and the 400 case; no leftover `cv.md`.

Then confirm no stray user file:
Run: `git status --porcelain | grep -E "cv.md$" || echo "no stray cv.md"`
Expected: `no stray cv.md`.

- [ ] **Step 6: Commit**

```bash
git add server/routes/setup.mjs server/index.mjs server/routes-tests.mjs
git commit -m "feat(web): add resume upload route + persist contact fields"
```

---

## Task 5: Frontend upload UI + docs + test registration

**Files:**
- Modify: `web/index.html`, `web/app.js`, `web/style.css`
- Modify: `test-all.mjs`, `docs/WEB_UI.md`

- [ ] **Step 1: Add the upload control and new profile inputs to `web/index.html`**

Replace the CV `<label>` line (line 20) and the Profile fieldset inputs with the following. Replace line 20:

```html
      <label>Paste your CV (markdown)<textarea id="cv" rows="8"></textarea></label>
      <label>…or upload your resume (PDF or .docx)
        <input type="file" id="cv-file" accept=".pdf,.docx">
      </label>
      <div id="upload-status"></div>
```

And add three inputs inside the Profile `<fieldset>`, after the `email` input (line 24):

```html
        <input id="phone" placeholder="Phone">
        <input id="linkedin" placeholder="LinkedIn URL">
        <input id="github" placeholder="GitHub URL">
```

- [ ] **Step 2: Add the upload handler and extend the profile save in `web/app.js`**

Add the upload handler after the `#save-cv` handler block (after line ~33):

```js
$('#cv-file').onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  $('#upload-status').textContent = 'Extracting…';
  try {
    const r = await fetch('/api/setup/cv/upload?filename=' + encodeURIComponent(file.name),
      { method: 'POST', body: file });
    if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || `HTTP ${r.status}`); }
    const { cvText, fields } = await r.json();
    $('#cv').value = cvText;
    const setIf = (id, v) => { if (v) $('#' + id).value = v; };
    setIf('full_name', fields.name); setIf('email', fields.email); setIf('phone', fields.phone);
    setIf('linkedin', fields.linkedin); setIf('github', fields.github);
    $('#upload-status').textContent = 'Extracted ✓ — review the fields below, then Save CV / Save Profile.';
    loadStatus();
  } catch (err) {
    showError('Upload failed: ' + err.message);
    $('#upload-status').textContent = '';
  }
};
```

Extend the `#save-profile` body (the `JSON.stringify({...})` object) to include the three new fields. Change it to:

```js
$('#save-profile').onclick = async () => {
  await api('/api/setup/profile', { method:'POST', headers:{'content-type':'application/json'},
    body: JSON.stringify({
      full_name: $('#full_name').value, email: $('#email').value, location: $('#location').value,
      phone: $('#phone').value, linkedin: $('#linkedin').value, github: $('#github').value,
      timezone: $('#timezone').value, salary_target: $('#salary_target').value,
      target_roles: $('#target_roles').value.split(',').map(s=>s.trim()).filter(Boolean) }) });
  loadStatus();
};
```

- [ ] **Step 3: Add minimal styling to `web/style.css`**

Append:

```css
#upload-status{font-size:13px;color:var(--muted);margin:6px 0}
input[type=file]{padding:6px 0}
```

- [ ] **Step 4: Manual UI check**

Run: `CAREER_OPS_WEB_PORT=3794 node server/index.mjs &` then open `http://127.0.0.1:3794`, go to Setup, upload `server/fixtures/sample.docx`. Confirm the CV textarea fills, and Email/Name (and phone/linkedin/github) pre-fill. Then `kill %1`.
Cleanup: if the upload created `cv.md`, remove it: `[ -f cv.md ] && git status --porcelain cv.md | grep -q '??' && rm cv.md; true` (only remove if untracked).
Expected: fields populate; no committed `cv.md`.

- [ ] **Step 5: Register the new tests in `test-all.mjs`**

After the three `server/*-tests.mjs` entries added in the Phase-1 work (near `server/routes-tests.mjs`), add:

```js
  { name: 'server/resume-fields-tests.mjs', expectExit: 0 },
  { name: 'server/http-tests.mjs', expectExit: 0 },
  { name: 'server/resume-extract-tests.mjs', expectExit: 0 },
```

- [ ] **Step 6: Update `docs/WEB_UI.md`**

Under the Setup capability, add a line:

```markdown
- **Resume upload** — on Setup, upload a PDF or `.docx`; the server extracts the text into `cv.md` and pre-fills email/phone/LinkedIn/GitHub/name for review. Deterministic and offline (no API key). Image-only/scanned PDFs can't be read — paste your CV instead. Legacy `.doc` is not supported (re-save as `.docx` or PDF).
```

- [ ] **Step 7: Run the full suite**

Run: `node test-all.mjs --quick`
Expected: PASS — the suite is green and includes the three new server tests. (Confirm no stray `cv.md`/`config/profile.yml`/`portals.yml` afterward: `git status --porcelain | grep -vE '\.codegraph|docs/' || true`.)

- [ ] **Step 8: Commit**

```bash
git add web/index.html web/app.js web/style.css test-all.mjs docs/WEB_UI.md
git commit -m "feat(web): resume upload UI, contact fields, docs, test registration"
```

---

## Self-Review Notes (for the implementer)

- **Spec coverage:** extraction smarts D1 (Task 1 fields + Task 3 text, no LLM), formats D2 (Task 3 dispatch + 400s), deps D3 (Task 3 install), raw-bytes upload D4 (Task 2 `readRawBody` + Task 4 route), populate-then-Save D5 (Task 4 route writes `cv.md`; Task 5 form prefill + existing Save). All covered.
- **No new deps beyond `pdf-parse`+`mammoth`** — verified against Global Constraints (raw-bytes upload avoids a multipart parser).
- **Signature consistency:** `extractFields`, `extractText` (with `.code` UNSUPPORTED_FORMAT / EMPTY_EXTRACTION), `readRawBody`, `postCvUpload` are referenced identically across tasks.
- **State hygiene:** the upload writes the real `cv.md`; the integration test (Task 4) and the manual check (Task 5) both delete it if they created it, so onboarding state and `git status` stay clean.
- **Fixtures are committed binaries**, so the suite is portable to Linux CI even though they're generated with macOS tooling locally.
```
