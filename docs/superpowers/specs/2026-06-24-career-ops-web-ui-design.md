# Career-Ops Web UI & Automated Job-Search — Design

**Date:** 2026-06-24
**Status:** Approved design, pending spec review
**Scope of this doc:** Full roadmap (5 features) with **Phase 1 specified in detail**; Phases 2–5 are a roadmap appendix and each gets its own spec when reached.

---

## 1. Goal

Extend career-ops so a non-technical user can run their entire Malaysia-focused job search from a browser: onboard, search by title, get experience-matched results, generate tailored CVs/cover letters, and track applications — with an optional auto-pilot that does everything up to (but not including) the final submit click.

## 2. Decisions locked during brainstorming

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | **Auto-prep, human submits.** Automation stops at a review queue; the user clicks Apply. | Platform ToS (LinkedIn/JobStreet) prohibit auto-applying; the repo has a hard "never auto-submit" rule. |
| D2 | **Local web app + Node backend.** Browser UI on localhost, thin Node server wrapping existing `.mjs` scripts. | Reuses all engine logic; no cloud/DB; approachable for non-technical users. |
| D3 | **Two-stage matching.** Stage 1 = zero-token deterministic filter; Stage 2 = LLM 6-block eval on the shortlist only. | Best quality/cost balance; keeps repeated auto-mode runs affordable. |
| D4 | **Plain HTML/JS UI for Phase 1** (no React/build step). | Smallest footprint for a local tool; revisit if UI complexity grows. |
| D5 | **LinkedIn = manual paste, not scrape.** | No public API; ToS prohibits scraping; protects the user's account. |

## 3. Guiding constraints (inherited from the repo)

- **Data contract is sacred.** `cv.md`, `config/profile.yml`, `modes/_profile.md`, `portals.yml`, `data/*`, `reports/*` are the user layer and the single source of truth. The web UI and API **read/write these same files** — no parallel database. The existing CLI and Go TUI keep working unchanged.
- **Human-in-the-loop.** Nothing is submitted to any employer without explicit user action.
- **Zero-token where possible.** Scanning and Stage-1 filtering cost no LLM tokens; only Stage-2 ranking and report generation do.
- **System vs user layer.** New code (`server/`, `web/`) is system layer (auto-updatable). It must not store user data anywhere except the existing user-layer files.

---

## 4. Architecture

```
┌──────────────────────────────────────────────────────────┐
│  web/  — plain HTML/CSS/JS served as static files         │
│  Screens: Onboarding · Search · Results · Review Queue ·  │
│           Application Board · Auto-pilot settings         │
└───────────────────────────┬──────────────────────────────┘
                            │ HTTP/JSON  +  SSE (live progress)
┌───────────────────────────▼──────────────────────────────┐
│  server/  — Node (Express or built-in http)               │
│  Thin routes that spawn existing .mjs and read/write       │
│  user-layer files. No business logic duplicated here.      │
└───────────────────────────┬──────────────────────────────┘
   spawn / import                       read / write
        │                                     │
┌───────▼─────────────┐         ┌─────────────▼─────────────┐
│ Engine (unchanged)  │         │ Data layer (unchanged)    │
│ scan.mjs            │         │ cv.md, config/profile.yml │
│ providers/*.mjs     │         │ portals.yml               │
│ role-matcher.mjs    │         │ data/applications.md      │
│ generate-pdf.mjs    │         │ reports/*.md              │
│ generate-cover….mjs │         │ data/pipeline.md          │
│ merge-tracker.mjs   │         │ batch/tracker-additions/  │
│ doctor.mjs          │         └───────────────────────────┘
└─────────────────────┘
```

**Why "wrap, don't rewrite":** every capability already exists as a script. The server's job is orchestration + serialization (turn file/CLI output into JSON for the browser), not re-implementing logic.

---

## 5. Phase 1 — Web UI + API server (the first shippable product)

Phase 1 delivers a complete, usable app over the *existing* data: onboard, view the application board, see progress. No new job sources or automation yet — those are later phases that plug into this shell.

### 5.1 Components

| Unit | Purpose | Depends on |
|------|---------|-----------|
| `server/index.mjs` | Boots the HTTP server, serves `web/`, mounts routes. | Node http/Express |
| `server/routes/setup.mjs` | Onboarding: read setup state, write `cv.md` / `profile.yml` / `portals.yml`. | `doctor.mjs`, file writes |
| `server/routes/applications.mjs` | List/read/update applications & reports as JSON. | `applications.md`, `reports/`, `tracker.mjs` |
| `server/lib/markdown-table.mjs` | Parse/serialize `applications.md`'s table ↔ JSON. | — |
| `server/lib/run.mjs` | Safe spawner for `.mjs` scripts; streams stdout as SSE. | child_process |
| `web/index.html` + `web/app.js` + `web/style.css` | The single-page UI. | fetch + SSE |

### 5.2 API surface (Phase 1)

```
GET  /api/setup/status        → doctor.mjs --json (onboardingNeeded, missing[])
POST /api/setup/cv            → write cv.md from pasted text/markdown
POST /api/setup/profile       → write config/profile.yml from form fields
POST /api/setup/portals       → copy + customize portals.yml
GET  /api/applications        → applications.md parsed to JSON rows
GET  /api/applications/:num   → one row + its linked report (rendered md)
PATCH /api/applications/:num  → update status / notes (existing-entry edits only)
```

> Note: `PATCH` only updates existing rows (allowed by the data contract). New rows are always added via `batch/tracker-additions/` + `merge-tracker.mjs`, never by direct table insert — this is reused in Phase 3+.

### 5.3 Screens (Phase 1)

1. **Onboarding wizard** — drives the same flow the CLI onboarding does, but as a form: paste CV → fill profile (name/email/location/target roles/salary) → confirm portals. Calls `doctor.mjs` to know what's missing; writes user-layer files. Mirrors the AGENTS.md onboarding steps so CLI and UI stay consistent.
2. **Application board** — a Kanban/table view of `applications.md` grouped by the 8 canonical states (`Evaluated · Applied · Responded · Interview · Offer · Rejected · Discarded · SKIP`). Click a card → read its report.
3. **Progress view** — simple counts/funnel over the canonical states (applied → responded → interview → offer).

### 5.4 Error handling

- Server validates every write against the data contract (reject writes to system-layer paths).
- Markdown-table parser is defensive: a malformed `applications.md` returns a clear error, never a partial overwrite. Writes are atomic (temp file + rename).
- Script spawns have timeouts; failures stream back to the UI with the script's stderr.
- If `doctor.mjs` reports `onboardingNeeded`, the UI routes the user to the wizard before anything else.

### 5.5 Testing

- Unit-test `markdown-table.mjs` round-trip (parse → serialize → identical) against the real `applications.md` shape, including the score-before-status column order.
- Unit-test the data-contract path guard (system-layer writes rejected).
- Integration-test each route against a temp fixture repo.
- Reuse the repo's existing `test-all.mjs` harness conventions.

---

## 6. Roadmap appendix — Phases 2–5 (each gets its own spec later)

### Phase 2 — Malaysia job sources (#2)
- **Already present:** `providers/jobstreet.mjs`, `providers/glints.mjs`.
- **Add:** verify/extend JobStreet & Glints coverage for MY; consider `providers/maukerja.mjs` / other MY boards that expose JSON.
- **LinkedIn:** manual paste/URL-drop into `data/pipeline.md` (per D5) — UI gets an "Add by URL" box; the existing pipeline evaluates it.
- **Config:** extend `portals.yml` with MY-focused queries + `title_filter` tuned to local titles; set location/remote filters.
- Each new source = one `providers/*.mjs` file following the existing provider contract (`id`, `detect`, `fetch`). Validate with `validate-portals.mjs`.

### Phase 3 — Title → matched list (#3)
- New route `POST /api/search { title, location, remote }` orchestrates:
  1. `scan.mjs` across enabled MY providers → raw postings.
  2. **Stage 1 (free):** filter by title keywords + location + `role-matcher.mjs` → shortlist (~25).
  3. **Stage 2 (LLM):** run the 6-block eval (`modes/oferta.md`) on the shortlist → scored /5 + report each.
- Results screen: ranked cards with score, fit summary, and a link to the full report.

### Phase 4 — Per-job CV/cover generation (#4)
- Reuses `generate-pdf.mjs` + `generate-cover-letter.mjs` (already tailor per job).
- UI "Generate for this job" → produces tailored CV PDF + cover letter draft into `output/`; shows a preview; user approves.

### Phase 5 — Auto-pilot prep mode (#5)
- A loop (driven by the repo's `/loop` or `/schedule` facility, or a server-side scheduler):
  `search → Stage-1 filter → Stage-2 rank → for each job ≥ user score threshold, auto-generate CV+cover → enqueue in Review Queue → notify user`.
- **Hard stop at the Review Queue** (D1). The user batch-reviews and clicks Apply per job.
- Auto-pilot settings screen: title(s), score threshold, sources, run cadence, max generations per run (cost guard).
- Tracker updates flow through `batch/tracker-additions/` + `merge-tracker.mjs`.

---

## 7. Out of scope (YAGNI)

- No hosted/multi-user SaaS, no auth, no database (D2).
- No auto-submit to any employer or job board (D1).
- No LinkedIn scraping (D5).
- No React/build pipeline in Phase 1 (D4).
- No changes to the data contract, CLI modes, or Go TUI behavior.

## 8. Build order

Phase 1 → 2 → 3 → 4 → 5. Phase 1 is independently useful; each later phase plugs into the Phase-1 shell and is specced separately when reached.
