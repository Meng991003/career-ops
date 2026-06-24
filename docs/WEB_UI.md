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
