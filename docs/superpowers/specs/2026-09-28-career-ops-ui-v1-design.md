# Career-Ops UI v1 — Design

**Date:** 2026-09-28
**Status:** Approved in a grilling session, pending implementation plan
**Supersedes (partially):** `2026-06-24-career-ops-web-ui-design.md` — replaces D4 (plain HTML/JS → React) and drops the Phase 5 auto-pilot from scope. The rest of that spec's constraints (data contract, human-in-the-loop, wrap-don't-rewrite) still hold.

---

## 1. Goal

A local browser UI so the candidate can:

1. **See everything at once** — 400+ tracker rows are unreadable in chat or raw markdown.
2. **Make quick edits** (status, notes) without starting an agent session.
3. **Preview and edit the tailored CV / cover letter** for a specific job, with the PDF re-rendered.
4. **Maintain preferences and experience** (profile, filters, cv.md, `_profile.md`).

**Audience:** the fork owner only, for now. Later: other career-ops users running it **locally** on their own machine. A hosted multi-user SaaS is explicitly out of scope — it would be a separate product decision, not a hedge built into this one.

## 2. Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| U1 | **Local-first. Files are the only database.** No DB, no auth, no multi-tenancy. | The CLI, the Go TUI and the UI can never disagree. Shareable later with no migration. |
| U2 | **React + Vite + Tailwind + shadcn/ui** frontend. | The existing vanilla UI is unfriendly; the win is off-the-shelf table, dialog, editor components, not React itself. Design quality still has to be designed. |
| U3 | **Keep the existing plain-Node `server/`** as the API. | Working, tested, no framework. Next.js would replace it and be heavier to ship locally. |
| U4 | **Frontend lives in a new top-level `ui/`**, built to `ui/dist/`, declared in `config/local-paths.txt`. | Upstream reserves `web/` for its own experimental UI (`validate-system-paths-coverage.mjs:96`); a fork-owned `web/` would conflict on every sync. `server/` is already declared local. |
| U5 | **All writes go through the career-ops scripts** or a comment-preserving YAML writer. The server never hand-edits the tracker. | AGENTS.md Pipeline Integrity rule #2; `set-status.mjs` owns the lock, validation and `status-log.tsv`. |
| U6 | **No AI triggers in v1.** The UI views, edits and runs deterministic scripts; anything needing judgement shows a "copy prompt into Claude Code" button. | Covers all three pains at a fraction of the cost; AI steps are the ones the candidate reviews in conversation anyway. First candidate for a later AI action: "Evaluate this URL". |
| U7 | **CV editing is a structured editor over the tailoring spec**, never WYSIWYG on the PDF/HTML. | PDF/HTML are build outputs — edits there are lost on rebuild and bypass the fact check. |
| U8 | **Per-job bullets are select-only** from cv.md. | Rewording per job is where fabricated claims creep in. A bullet that reads wrong is fixed in cv.md. |
| U9 | **Tracking: table first, plus an active-only kanban.** | 210 Evaluated / 68 SKIP cards make a full kanban useless; the active pipeline is a handful of cards. |
| U10 | **Home screen is "Today"**, fed by existing zero-token scripts. | Turns a viewer into the morning routine; `daily-jobs` already does this in chat. |
| U11 | **The Go TUI (`dashboard/`) is untouched.** | Isolated, optional, still useful. |

## 3. Architecture

```
ui/  (React + Vite, built to ui/dist/)
  │  fetch JSON
  ▼
server/  (plain Node http, 127.0.0.1:3700, serves ui/dist/)
  │  spawn scripts / read files / comment-preserving YAML write
  ▼
career-ops scripts            user-layer files (unchanged)
set-status.mjs                cv.md, config/profile.yml, portals.yml
build-cv.mjs                  modes/_profile.md
generate-pdf.mjs              data/applications.md, data/status-log.tsv
generate-cover-letter.mjs     data/follow-ups.md, data/active-interviews.md
verify-cv-facts.mjs           data/contacts.tsv, reports/, jds/
stats.mjs, funnel-velocity.mjs tailor/*.yml, tailor/covers/*.json
followup-cadence.mjs          output/NNN-slug/
rejection-latency.mjs
daily-digest.mjs
```

The server stays a thin orchestration + serialization layer: turn file and script JSON output into API responses. No business logic is duplicated.

### 3.1 Hard requirements (non-negotiable)

- **Localhost CSRF guard.** Any website can `POST` to `127.0.0.1:3700` (a `text/plain` body skips the CORS preflight). The server rejects every request whose `Host` / `Origin` is not its own. Today it has no check, and it can write the CV.
- **Conflict detection.** Every read returns a version (mtime or content hash); every write sends it back. If the file changed on disk since, the server returns `409` and the UI shows "changed outside — reload". Claude Code edits the same files while the UI is open.
- **Comment-preserving YAML.** Use the `yaml` package (Document API) for `profile.yml` / `portals.yml` writes. `profile.yml` has 58 comment lines, `portals.yml` 41.
- **Bind 127.0.0.1 only** (already the case).

### 3.2 Existing defects this design fixes (found 2026-09-28)

| Where | Defect |
|---|---|
| `server/routes/applications.mjs` `patch` | Writes `applications.md` directly — bypasses `set-status.mjs`'s lock, validation and `status-log.tsv`. Hard-coded `CANON` list omits `Hired`. |
| `server/routes/setup.mjs` (lines 27, 70, 120) | `js-yaml` load → dump deletes every comment in `profile.yml` / `portals.yml` on first save. |
| `server/index.mjs` | No Origin/Host check (see 3.1). |

## 4. Screens

### 4.1 Today (home)

Each item is backed by an existing script's JSON output:

- **Overdue follow-ups** — `followup-cadence.mjs`; copy-prompt to draft the follow-up.
- **New roles from the latest digest** — `daily-digest.mjs`; score, apply-route badge (`gated` / `likely-gated` / `open`), copy-prompt to evaluate.
- **Unacted evaluations ≥ 4.0** — tracker rows still `Evaluated`.
- **Interviews gone quiet** — `rejection-latency.mjs`.
- **Stale tailored CVs** — built from an older cv.md (see 4.5).
- **Funnel strip** — applied → response rate → interview, from `stats.mjs`; links to Stats.

### 4.2 Applications

- **Table (default):** sort and filter by status, score, date, company, apply route; free-text search; saved filters (e.g. "Evaluated ≥ 4.0 not applied", "Applied > 14 days no reply", "Interviewing").
- **Kanban tab:** active statuses only — Applied → Responded → Interview → Offer → Hired. Drag and drop calls `set-status.mjs`.
- Row click opens the detail drawer.

### 4.3 Job detail drawer

1. **Header** — company, role, score, status dropdown (via `set-status.mjs`), posting URL, apply-route badge.
2. **Timeline** — `status-log.tsv` transitions + `follow-ups.md` + `active-interviews.md` rounds.
3. **Notes** — append-only via `set-status --note`. Send only the new text; re-sending the old note duplicates it.
4. **Documents** — CV / cover PDF preview tabs with **Edit** → the editor (4.4). When none exist: "No tailored CV — copy prompt: `/career-ops pdf {N}`".
5. **Report** — rendered, Blocks A–G collapsible, `## Machine Summary` as chips.
6. **Contacts** — from `data/contacts.tsv`; warning when empty (all 18 overdue applications had no contact on record).
7. **Archived JD** — link via `jd-capture.mjs` when one exists.

Out of the drawer: form answers, interview prep, story bank (they belong to the chat workflows; read-only links at most).

### 4.4 CV / cover letter editor

Split screen: structured form left, live PDF preview right.

- **CV:** form over `tailor/{slug}.yml` — summary text, competency chips, skill groups, per-job bullet toggles (select-only, sourced from cv.md). The spec's header comments (strategy, deliberately-absent claims) are shown read-only above the form and preserved on write.
- **Cover letter:** paragraph fields over the cover payload JSON.
- **Save** → write spec (comment-preserving) → `build-cv.mjs` / `generate-pdf.mjs` or `generate-cover-letter.mjs` → `verify-cv-facts.mjs`. Flagged claims are shown inline and block nothing, but are impossible to miss.

### 4.5 Preferences & experience

- `config/profile.yml` — real forms (chip inputs for target roles, numbers for comp, dropdowns for location).
- `portals.yml` — form for `title_filter` / `location_filter` / `salary_filter`; add/remove table for `tracked_companies`.
- `cv.md` — markdown editor with rendered preview. On save, tailored CVs built before the change are flagged **stale — rebuild?** (never auto-rebuilt).
- `modes/_profile.md` — markdown editor with a heading outline (~20 sections). Mostly read, occasionally edited.

### 4.6 Stats

Full page backed by `stats.mjs` and `funnel-velocity.mjs` (funnel, stage velocity, scan trends).

## 5. Milestones

Each is independently usable.

| # | Milestone | Exit check |
|---|-----------|------------|
| **M0** | Server hardening: tracker writes via `set-status.mjs`, comment-preserving YAML, CSRF guard, 409 conflict detection. Scaffold `ui/` and declare it in `config/local-paths.txt`; server serves `ui/dist/`. | Existing `server/*-tests.mjs` pass; new tests: foreign-Origin POST → 403, stale-version write → 409, profile save keeps comments, status change appends to `status-log.tsv`. |
| **M1** | Applications table + detail drawer, status and notes editing. | Change a status in the UI → `set-status.mjs` output and `status-log.tsv` row match a CLI change. |
| **M2** | Today home + active kanban + Stats. | Today items match the scripts' own `--summary` output. |
| **M3** | CV / cover editor with rebuild + fact check. | Edit a summary → PDF regenerated → spec comments intact → `verify-cv-facts.mjs` result displayed. |
| **M4** | Preferences / experience editors, stale-CV flags. Old `web/` files deleted. | Setup parity with the old UI; cv.md edit flags existing tailored CVs stale. |

## 6. Out of scope (v1)

- Hosted / multi-user deployment, auth, database.
- Triggering AI work (evaluate, tailor, scan, draft) — copy-prompt buttons instead.
- Rewording bullets per job.
- WYSIWYG editing of rendered CV/cover.
- Form answers, interview prep, story bank editing.
- Changes to the Go TUI.
- Upstreaming — later, as a discussion with the maintainer about whether `ui/` becomes their `web/`.

## 7. Open questions (resolve during planning)

- **Cover letter source of truth for M3:** both `tailor/covers/NNN.json` and `output/NNN-slug/cover-payload.json` exist. Confirm which one `generate-cover-letter.mjs` is fed from in the current workflow before building the editor over it.
- **Tailor spec ↔ tracker row mapping:** specs are named by company slug (`tailor/dbs-bank.yml`), not report number. Confirm how to resolve a row's spec reliably (header comment "Report 126", output dir, or a new explicit field).
- **Stale detection signal:** cv.md mtime vs PDF mtime is the simplest; confirm it is good enough (a cv.md typo fix would flag all ~45 CVs).
