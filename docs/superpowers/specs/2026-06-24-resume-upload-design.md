# Resume Upload & Auto-Extract — Design

**Date:** 2026-06-24
**Status:** Approved design, pending spec review
**Builds on:** the Career-Ops Web UI (Phase 1) — branch `feat/web-ui-phase1`. This extends the onboarding flow only.

---

## 1. Goal

Let a user upload their existing resume (PDF or modern `.docx`) on the Setup tab. The system extracts the text into `cv.md` and pre-fills the reliably-detectable profile fields (email, phone, LinkedIn, GitHub, name), which the user then reviews and saves. This replaces "paste your CV markdown" as the primary path while keeping paste as a fallback.

## 2. Decisions locked during brainstorming

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | **Deterministic extraction now; AI-polish deferred.** Server extracts text + regex-fills reliable fields. No LLM, no API key required. | Onboarding must work offline for everyone; the CLI agent can refine `cv.md` later. AI structuring is a future optional add. |
| D2 | **Formats: PDF + `.docx` only.** Legacy binary `.doc`, image/scanned PDFs (OCR) are out of scope. | `.doc` needs external tooling; OCR is a different project. `.docx` + text PDFs cover the vast majority. |
| D3 | **Add two npm deps: `pdf-parse`, `mammoth`.** Relaxes the Phase-1 "no new deps" rule. | PDF/DOCX text extraction is impossible with Node built-ins. Both are mature, pure-JS, no native build. |
| D4 | **Raw-bytes upload, no multipart library.** Frontend sends the file as the raw request body; server reads bytes via a new `readRawBody`. | Avoids a third dependency (multipart parser). |
| D5 | **Upload only populates the form; existing Save endpoints do the writes.** | Reuses the data-contract guard; the user always reviews before anything is written as final. (The upload route itself writes `cv.md` — a user-layer path — directly, also through the guard.) |

## 3. Guiding constraints (inherited)

- **Data contract:** the only file this feature writes is `cv.md`, always via `resolveUserPath('cv.md')` + `atomicWrite`. No other path is written.
- **No multipart/extra deps** beyond `pdf-parse` and `mammoth`.
- **Body size:** uploads reuse the existing 8 MB cap (`readRawBody` mirrors `readJsonBody`'s limit).
- **System layer:** all new code is in `server/` and `web/` (auto-updatable layer). No user data stored anywhere but `cv.md`.
- **Server stays LLM-free.** No network calls in the extraction path.

---

## 4. Architecture

```
Setup tab (web/)
  [ Upload resume (PDF/DOCX) ]  +  existing [ paste CV ] fallback
        │ fetch(POST, body = raw file bytes, ?filename=resume.pdf)
        ▼
POST /api/setup/cv/upload         (server/routes/setup.mjs :: postCvUpload)
        │ readRawBody(req)  → Buffer (≤ 8 MB)
        │ extractText(buf, filename)        (server/lib/resume-extract.mjs)
        │    .pdf  → pdf-parse
        │    .docx → mammoth
        │    else  → throw UnsupportedFormat
        │ → text (throw EmptyExtraction if blank)
        │ atomicWrite(resolveUserPath('cv.md'), text)
        │ fields = extractFields(text)      (server/lib/resume-fields.mjs)
        ▼ 200 { ok:true, cvText, fields }
Frontend: put cvText in the CV textarea, fill matching profile inputs from `fields`,
          user reviews → clicks existing Save CV / Save Profile.
```

Nothing in the existing routes, the data-contract guard, or the Save flow changes. The upload is additive.

---

## 5. Components

| Unit | Interface | Depends on |
|------|-----------|-----------|
| `server/lib/resume-extract.mjs` | `extractText(buffer: Buffer, filename: string) -> Promise<string>`. Dispatches by lowercased extension. Throws `Error` with `.code = 'UNSUPPORTED_FORMAT'` for non pdf/docx, `.code = 'EMPTY_EXTRACTION'` when the result trims to empty. | `pdf-parse`, `mammoth` |
| `server/lib/resume-fields.mjs` | `extractFields(text: string) -> { email, phone, linkedin, github, name }` (each a string, `''` if not found). **Pure function, no I/O.** | — |
| `server/lib/http.mjs` (modify) | add `readRawBody(req) -> Promise<Buffer>` — collect chunks as a Buffer, reject `Error('payload too large (>8MB)')` past 8 MB, single-settle guard like `readJsonBody`. | Node built-ins |
| `server/routes/setup.mjs` (modify) | add `postCvUpload(req, res)`: parse `?filename`, `readRawBody`, `extractText`, write `cv.md`, `extractFields`, return `{ok,cvText,fields}`. Map `UNSUPPORTED_FORMAT`/`EMPTY_EXTRACTION` → 400 with a clear message; other throws fall through to the dispatcher's 500. | the libs above, `resolveUserPath`, `atomicWrite`, `sendJson` |
| `server/index.mjs` (modify) | register `['POST', /^\/api\/setup\/cv\/upload$/, setup.postCvUpload]` BEFORE the existing `/api/setup/cv` route is irrelevant (distinct path) — just add the route entry. | — |
| `web/index.html` + `web/app.js` + `web/style.css` (modify) | a file `<input accept=".pdf,.docx">` + "Upload resume" button in the onboarding section; on change, POST the file bytes, then fill `#cv` textarea with `cvText` and set `#email/#full_name` etc. from `fields`; show extraction errors in the existing error banner. | the upload endpoint |

### 5.1 `extractFields` heuristics (deterministic)
- **email:** first match of a standard email regex.
- **phone:** first match of a permissive international/local phone regex (digits, spaces, `+`, `-`, `()`), length-guarded to avoid matching long ID numbers.
- **linkedin:** first URL containing `linkedin.com/in/` (or `linkedin.com/`).
- **github:** first URL containing `github.com/` (excluding `github.io` pages optional).
- **name:** best-effort — the first non-empty line of the document if it has 2–4 capitalized words and contains no `@`/digits; else `''`. (Low confidence; the user edits it.)
- Each field independent; absence → `''`. Never throws.

---

## 6. API

```
POST /api/setup/cv/upload?filename=<name.ext>
  body: raw file bytes (Content-Type ignored; extension drives the extractor)
  200 → { ok:true, cvText:<string>, fields:{ email, phone, linkedin, github, name } }
  400 → { error:"Unsupported file — upload a PDF or .docx" }            (UNSUPPORTED_FORMAT)
  400 → { error:"Couldn't read text — the file may be image-only; paste your CV instead." } (EMPTY_EXTRACTION)
  500 → { error:"payload too large (>8MB)" }   (oversize: readRawBody rejects → dispatcher 500)
```

`filename` is used only to read the extension; it is never used as a write path (the write target is always `cv.md`).

---

## 7. Error handling

- Missing/blank `filename` or no recognizable extension → 400 UNSUPPORTED_FORMAT.
- `pdf-parse`/`mammoth` throw (corrupt file) → dispatcher 500 with the message.
- Empty/whitespace extracted text → 400 EMPTY_EXTRACTION; the paste fallback remains.
- The frontend shows all of these in the existing `#error-banner` (textContent, no innerHTML).
- The write to `cv.md` is atomic; a failed extraction never writes a partial file (extraction happens before the write).

## 8. Testing

- `server/resume-fields-tests.mjs` (pure, fast): sample resume text → assert each field; cases: multiple emails (pick first), no phone (`''`), linkedin + github present, name heuristic hit and miss. Repo's PASS/FAIL idiom, exit 0/1.
- `server/resume-extract-tests.mjs`: commit tiny fixtures `server/fixtures/sample.docx` and `server/fixtures/sample.pdf` containing known text (e.g. "Jane Tester jane@example.com"); assert `extractText` returns text containing those strings; assert an unsupported extension (`x.txt`) rejects with `code === 'UNSUPPORTED_FORMAT'`; assert an empty/garbage buffer for `.pdf` surfaces an error (either thrown by the lib → 500, or EMPTY_EXTRACTION).
- Register both test files in `test-all.mjs`.
- Manual: upload a real PDF and a real .docx through the UI; confirm `cv.md` written and fields pre-filled.

## 9. Out of scope (YAGNI)

- Legacy binary `.doc`, image/scanned-PDF OCR.
- The "Polish with AI" / Gemini structuring endpoint (deterministic result is fully usable; this is a clean later add).
- Storing the original uploaded file (we keep only the extracted `cv.md`).
- Drag-and-drop, multi-file, progress bars.

## 10. Dependencies added

`pdf-parse` and `mammoth` added to `package.json` `dependencies` (pure-JS, no native build). No other deps. `package-lock`/install updates as normal.
