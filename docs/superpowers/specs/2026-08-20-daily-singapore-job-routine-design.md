# Daily Singapore Job Routine — Design

**Date:** 2026-08-20
**Status:** Approved (design), pending implementation plan
**Owner:** Wai Chun Meng

## Goal

A daily routine that finds Singapore software-engineering roles matching the
candidate's resume, ranks the ones not yet applied to, generates tailored
application material on request, assists with filling the application form, and
records the outcome as an HTML report.

The routine is built as a thin extension of the existing career-ops pipeline.
Roughly 80% of the required capability already exists in this repo and is reused
rather than reimplemented: portal scanning, dedup, fit scoring, ATS-PDF CV
generation, cover-letter generation, liveness checking, and the tracker.

## Non-goals

These are explicit exclusions, not deferred work:

- **No unattended application submission.** Every submit requires the
  candidate's approval in the moment, per application. No standing
  pre-authorization.
- **No CAPTCHA solving.** The routine halts and hands control back.
- **No credential handling.** The routine never enters passwords, never creates
  accounts, and never logs in. It operates only inside browser sessions the
  candidate has already authenticated.
- **No logged-in LinkedIn scraping.** Only LinkedIn's public unauthenticated
  guest endpoint is used, which carries no risk to the candidate's account.
- **No Malaysia-region scanning.** Singapore only, per the candidate's decision
  on 2026-08-20.
- **No salary or metric fabrication.** The resume carries exactly one hard
  metric (up to 30% performance gains). Nothing else may be invented.

## Constraints

### Employment Pass salary floor

The candidate is based in Kuala Lumpur and holds no Singapore PR or Employment
Pass, so any Singapore role must be able to sponsor an EP. Singapore's Ministry
of Manpower sets a minimum qualifying salary for EP eligibility (approximately
SGD 5,600/month for most sectors as of early 2025, higher for financial
services, and scaling upward with candidate age), alongside the COMPASS points
framework.

`config/profile.yml` therefore sets `compensation.minimum: SGD6000` — chosen to
clear that threshold with margin, not because 6000 reflects a preference. A
lower floor surfaces roles that legally cannot sponsor the candidate.

**These figures change.** Re-verify against MOM before adjusting the floor.

### Safety model

Two hard approval gates per application, neither of which carries to the next
job:

| Gate | What the candidate reviews | What happens on approval |
|------|---------------------------|--------------------------|
| 1 | Tailored CV PDF + cover letter | Routine opens the application form |
| 2 | Every field the routine filled, on screen | Routine clicks submit |

The routine halts unconditionally on: a CAPTCHA, a login wall, a detected
company/role mismatch against the matched report, or a posting that liveness
checking marks dead.

### Upstream-conflict surface

career-ops is a clone of the OSS project `santifer/career-ops` with a self-updater
(`npm run update`). Paths differ in whether local edits survive an update:

| Path | Tracked by git | Survives update |
|------|---------------|-----------------|
| `config/profile.yml`, `portals.yml`, `cv.md`, `data/pipeline.md`, `data/applications.md`, `reports/*.md`, `output/*` | no (gitignored) | yes |
| `providers/*.mjs`, `modes/*.md`, `.claude/skills/career-ops/SKILL.md` | yes | **no** |

Design consequence: new work goes into untracked paths or new files wherever
possible. Exactly one delta touches a tracked file, and it is a genuine upstream
bug fix worth submitting as a PR.

## Architecture

Seven deltas on top of career-ops.

| # | Piece | Path | Type |
|---|-------|------|------|
| 1 | JobStreet provider fix | `providers/jobstreet.mjs` | fix (tracked) |
| 2 | LinkedIn guest provider | `providers/linkedin-guest.mjs` | new |
| 3 | Portal configuration | `portals.yml` | new (untracked) |
| 4 | Q&A knowledge base | `data/answers.yml` | new (untracked) |
| 5 | Daily digest generator | `daily-digest.mjs` | new |
| 6 | Orchestration playbook | `.claude/skills/daily-jobs/SKILL.md` | new |
| 7 | Scheduled scan | scheduled task | new |

### Delta 1 — Fix `providers/jobstreet.mjs`

The existing provider is **broken**: it targets `api/chalice-search/v4/search`,
which now returns HTTP 404. Verified working replacement:

```
GET https://sg.jobstreet.com/api/jobsearch/v5/search
      ?siteKey=SG-Main
      &keywords=<terms>
      &where=Singapore
      &pageSize=<n>
      &page=<n>
```

No authentication. Verified 2026-08-20 returning 5,433 matches for
"software engineer" in Singapore.

The v5 response shape differs from v4 and requires remapping:

| Field | v5 source | Note |
|-------|-----------|------|
| company | `advertiser.description` | `branding` was `{}` in sampled responses; `companyName` is a secondary fallback |
| location | `locations[0].label` | v4's flat `location` is gone |
| salary | `salaryLabel` | Free text, e.g. `"$4,000 – $6,000 per month"` |
| posted | `listingDate` | ISO 8601 |
| url | built as `https://sg.jobstreet.com/job/{id}` | **v5 has no `jobUrl` field** |

Add `SG-Main` handling and keep `sg.jobstreet.com` in the existing host
allowlist (already present).

**New requirement — emit structured salary.** The provider currently requests
salary but never emits it, so `scan.mjs`'s salary filter can never act on
JobStreet results. Add a `parseSalaryLabel(label)` export returning
`{min, max, currency}` or `null`, following the convention already established
by `providers/ashby.mjs` `parseCompensation`:

- **Annualize.** `scan.mjs`'s `buildSalaryFilter` uses annual semantics.
  `per month` × 12, `per year`/`per annum`/`annually` × 1.
- Uppercase currency. A bare `$` on `sg.jobstreet.com` means `SGD`.
- Handle both en-dash (`–`) and hyphen ranges, thousands separators, and
  single-value labels (`"$5,000 per month"` → min = max).
- Return `null` on anything unparseable, so the job passes the filter
  conservatively rather than being wrongly dropped.

`parseJobstreetItem` is already exported for unit testing; `parseSalaryLabel`
must be too.

### Delta 2 — `providers/linkedin-guest.mjs`

```
GET https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search
      ?keywords=<terms>&location=Singapore&start=<n>
```

Unauthenticated. Verified 2026-08-20 returning 10 job cards per request as an
HTML fragment (not JSON). Parsed per `<li>` card:

| Field | Selector / pattern |
|-------|-------------------|
| title | `base-search-card__title` |
| company | `hidden-nested-link` |
| location | `job-search-card__location` |
| posted | `datetime` attribute |
| url | `href` matching `linkedin.com/jobs/view/...` |

Emits no salary (the guest endpoint does not expose it), so LinkedIn results
always pass the salary filter and must be labelled salary-undisclosed in the
digest.

`detect()` returns `null` — LinkedIn is an aggregator, requiring explicit
`provider: linkedin-guest` in `portals.yml`, matching the jobstreet precedent.

**Treated as a best-effort source.** It is an undocumented endpoint that can
rate-limit by IP or change shape without notice. LinkedIn's User Agreement
prohibits automated collection; usage here is one low-volume unauthenticated
scan per day for personal job search, and the candidate has accepted this
tradeoff. Requests are sequential with a delay between pages, capped at a
configurable page count.

### Delta 3 — `portals.yml`

Singapore-scoped. Derived from `config/profile.yml`:

- `tracked_companies`: JobStreet SG (`provider: jobstreet`, `siteKey: SG-Main`)
  and LinkedIn (`provider: linkedin-guest`), one entry per search keyword group
  drawn from `target_roles.primary`.
- `title_filter.negative`: `intern`, `internship`, `graduate programme`,
  `director`, `head of`, `vp`, `principal`, `manager` — the scan run on
  2026-08-20 surfaced an RM1,200 internship, confirming this is needed.
- `title_filter.seniority_boost`: `senior`, `mid`, `full stack`, `backend`
  — the candidate held a Senior title (Hokenso, 2023–2025), so Senior postings
  are in band, not stretch.
- `location_filter`: Singapore only.
- `salary_filter`: `min: 72000`, `max: 0`, `currency: SGD` — the SGD6000/month
  floor annualized, matching the filter's annual semantics.

Because the salary filter passes jobs with no salary data, the majority of
listings will pass it. This is intended: many strong Singapore roles do not post
salary. The digest labels them explicitly so the candidate is not misled into
thinking the floor was verified.

### Delta 4 — `data/answers.yml`

The Q&A knowledge base. It accumulates personal data, so it must never enter
version control.

**`.gitignore` does not cover this by default.** The `data/` rules list files
individually (`data/pipeline.md`, `data/applications.md`, ...) — there is no
blanket `data/*`, so a new `data/answers.yml` would be tracked. Implementation
must add the ignore rule in **both** places: `.gitignore` (discoverable and
portable) and `.git/info/exclude` (local-only, so `npm run update` cannot revert
it). Verify with `git check-ignore -v data/answers.yml` before the first write.

```yaml
- q: What is your notice period?
  match: [notice, availability, start date, when can you start]
  scope: universal
  a: 2 months
  updated: 2026-08-20

- q: Do you have the right to work in Singapore?
  match: [right to work, work pass, visa, sponsorship, eligible to work]
  scope: universal
  a: >-
    I am based in Malaysia and would require a Singapore Employment Pass.
    I do not currently hold Singapore PR or an EP.
  updated: 2026-08-20

- q: Why do you want to join {company}?
  match: [why, interested, motivat]
  scope: per-job
  updated: 2026-08-20
```

Semantics:

- `scope: universal` — filled automatically, every time, no prompt.
- `scope: per-job` — drafted fresh from that job's career-ops report, surfaced
  to the candidate at gate 2. Never auto-filled from a stale answer.
- **Unmatched question** — the routine asks the candidate once, then appends the
  answer with `scope` and `updated`, so the same question is never asked twice.
- `match` is a list of case-insensitive substrings tested against the form's
  question text. First match wins; the routine reports which entry it matched so
  a wrong match is visible at gate 2 rather than silent.

Seeded from `config/profile.yml` at implementation time with the facts already
known: notice period (60 days), visa status, target salary, location, years of
experience, current employer.

### Delta 5 — `daily-digest.mjs`

Reads `data/pipeline.md` (scanner output) and `data/applications.md` (applied
history), writes `output/digest-YYYY-MM-DD.html`.

- Top 10 unapplied roles, ranked by career-ops fit score.
- Per row: title, company, location, salary (or an explicit
  "salary undisclosed" marker), posted date, fit score, source, link.
- A second section listing applications submitted that day, so the file doubles
  as the post-application report. Regenerated after each submission, keeping one
  always-current artifact per day rather than a separate receipt file.
- If fewer than 10 unapplied roles exist, it reports what exists. No padding.
- If a source failed during the scan, the digest states which one, so a silently
  short list is never mistaken for a quiet market.

Self-contained HTML, no external assets, readable in both light and dark.

### Delta 6 — `.claude/skills/daily-jobs/SKILL.md`

The orchestration playbook, as a standalone project skill.

**Deviation from the approved design, and why:** the approved design placed this
at `modes/daily.md`, which would have required editing the router table in
`.claude/skills/career-ops/SKILL.md`. Both are git-tracked and auto-updatable,
so an update could clobber the mode and its routing. A standalone skill is one
fewer file, needs no router edit, and cannot be clobbered.

The skill instructs the agent to read `modes/_shared.md` and `modes/_profile.md`
first, inheriting career-ops' scoring rules, sources of truth, and the
`voice-dna.md` anti-slop guardrail. It then encodes: the six workflow steps,
both approval gates, the halt conditions, and the `answers.yml` read/append
protocol.

### Delta 7 — Scheduled scan

A scheduled task at 07:00 Asia/Kuala_Lumpur running only the unattended half:
scan, then digest. It performs no browser automation, submits nothing, and
requires no approval, because it only reads public endpoints and writes local
files.

## Data flow

**Unattended, 07:00 daily:**

```
scan.mjs ← portals.yml
   ├─→ JobStreet SG   (api/jobsearch/v5/search, structured salary)
   └─→ LinkedIn guest (best-effort; failure is non-fatal)
   → title_filter → location_filter → salary_filter
   → dedup vs data/applications.md      (drops anything already applied to)
   → fit-score vs config/profile.yml + cv.md
   → data/pipeline.md
   → daily-digest.mjs → output/digest-YYYY-MM-DD.html
```

**Interactive, candidate-initiated:**

```
candidate picks roles from the digest
  → career-ops evaluation (fit report + Block G scam / ghost-job check)
  → check-liveness.mjs           (drop dead postings BEFORE spending a CV)
  → tailored CV PDF + cover letter
        └─ GATE 1: candidate reviews material
  → routine opens the form in the candidate's already-authenticated browser
  → fills fields from cv.md + profile.yml + data/answers.yml
        └─ unmatched question → ask candidate → append to answers.yml
        └─ GATE 2: candidate reviews every filled field on screen
  → candidate says "submit this one" → routine clicks submit
  → tracker marks applied → digest regenerated
```

## Error handling

| Condition | Behaviour |
|-----------|-----------|
| LinkedIn 429, shape change, or timeout | Log, skip that source, continue. Digest names the failure. One dead source never fails the scan. |
| JobStreet page >1 fails | Return what was collected (existing provider behaviour). Page 1 failing is fatal for that entry. |
| `salaryLabel` unparseable | `parseSalaryLabel` returns `null`; job passes conservatively and is labelled salary-undisclosed. |
| CAPTCHA | Halt. Hand to candidate. No retry. |
| Login wall | Halt. Ask candidate to log in. Never touch credentials. |
| Company/role mismatch vs matched report | Halt before drafting; ask whether to re-evaluate, adapt, or stop (existing `modes/apply.md` preflight). |
| Posting dead | Drop before generating material. |
| Fewer than 10 unapplied roles | Report what exists. No padding. |
| `answers.yml` malformed | Fail loudly at load. Never silently fall back to empty, which would cause wrong answers to be filled into a real application. |

## Testing

TDD, following the repo's existing `*-tests.mjs` convention.

| Unit | Test | Fixtures |
|------|------|----------|
| `parseJobstreetItem` | v5 shape → canonical Job; missing `jobUrl`; empty `branding`; untrusted host rejected | Real v5 responses captured 2026-08-20 (SG + MY) |
| `parseSalaryLabel` | monthly → annualized ×12; yearly ×1; en-dash and hyphen ranges; single value; thousands separators; unparseable → `null`; currency uppercased | Real `salaryLabel` strings |
| LinkedIn card parser | 10 cards from one fragment; missing company; relative vs absolute href; malformed card skipped not fatal | Real guest-endpoint HTML captured 2026-08-20 |
| `daily-digest.mjs` | top-10 cap; fewer-than-10; applied-today section; source-failure note; salary-undisclosed labelling | Fixture `pipeline.md` + `applications.md` |

Plus one live smoke run per source, asserting a non-empty normalized result, run
manually rather than in CI so a third-party outage never fails the suite.

The salary path carries the highest cost of being wrong in either direction — a
parsing bug either hides affordable roles or surfaces roles that cannot sponsor
an EP — so it gets the densest coverage.

## Open risks

1. **LinkedIn endpoint fragility.** Undocumented; may break or rate-limit at any
   time. Mitigated by non-fatal failure handling and by JobStreet being the
   reliable primary source.
2. **EP threshold drift.** MOM figures change. The SGD6000 floor should be
   re-verified periodically.
3. **Delta 1 is on a tracked path.** `npm run update` can revert the JobStreet
   fix. Mitigated by upstreaming it as a PR to `santifer/career-ops`.
4. **Playwright MCP not configured.** `npm run doctor` flags this; it affects
   career-ops' browser-driven JD fetching and liveness checks. Both scan sources
   here are direct HTTP and unaffected, and form-filling uses the candidate's
   own browser, so this only degrades liveness verification.
5. **`answers.yml` accumulates personal data.** Ignored in both `.gitignore` and
   `.git/info/exclude`, never committed. The double rule is deliberate: the
   updater owns `.gitignore` and could revert a single entry, silently
   un-ignoring a file full of personal answers.

## Assumptions to confirm

- `location.visa_status` in `config/profile.yml` currently states no existing
  Singapore PR or EP. This was inferred, not supplied. It drives the entire EP
  salary floor and appears in every Singapore application form. **If wrong, the
  salary floor and the seeded visa answer both need revising.**
- Remote roles were excluded, reading "Singapore jobs" as on-site or hybrid. If
  Singapore-based remote roles are wanted, `location_filter` needs widening.
