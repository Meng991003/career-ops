---
name: daily-jobs
description: Daily Singapore job routine — review the morning digest, tailor material for chosen roles, and assist the application under two approval gates. Use when the user wants to review today's jobs, apply to a role, or asks about their job search pipeline.
user_invocable: true
---

# Daily Jobs — Singapore Routine

Read `modes/_shared.md` FIRST, then `modes/_profile.md` **if it exists** (every
upstream mode guards it the same way). They carry the scoring rules, sources of
truth, and the `voice-dna.md` anti-slop guardrail that all candidate-facing text
must obey.

**If `modes/_profile.md` is missing, say so once, then continue.** Only
`modes/_profile.template.md` ships with career-ops; `node doctor.mjs` reports
the absent file as an error. Until the candidate creates it —
`cp modes/_profile.template.md modes/_profile.md`, then fill it in with their own
archetypes, narrative, proof points and voice rules — the archetype and narrative
guidance this routine would otherwise inherit is simply absent, so evaluations
will be blunter and generated CVs, letters and form answers noticeably more
generic. Never write that file for them: it is the candidate's personal content
and inventing it would fabricate résumé facts (rule 4).

Run everything from the career-ops project root.

## Non-negotiable rules

1. **Never submit an application without explicit approval for that specific
   application.** Approval for one job never carries to another.
2. **Never solve a CAPTCHA.** Stop and hand control to the candidate.
3. **Never enter a password, create an account, or log in.** Work only in
   browser sessions the candidate has already authenticated. If a login wall
   appears, stop and ask them to log in.
4. **Never invent a résumé fact.** The resume carries exactly one hard metric
   (up to 30% performance gains at Itechoice). Everything else must trace to
   `cv.md`, `config/profile.yml`, or `data/answers.yml`.
5. **Never present the triage score as a fit score.** Triage is cheap title and
   salary ordering. The A–F score requires the full evaluation.

## Step 1 — Show the digest

Determine today's digest filename using the candidate's configured timezone,
since the scheduled 07:00 local run may be 23:00 UTC the previous day:

```bash
node -e "Promise.all([import('./daily-digest.mjs'),import('js-yaml')]).then(async([d,y])=>{const {readFileSync}=await import('fs');console.log('output/digest-'+d.digestDate(y.default.load(readFileSync('config/profile.yml','utf8')))+'.html')})"
```

Computing the date any other way will look for the wrong file and make the
routine report "digest missing" every morning even though the scan ran.

Read the resulting `output/digest-<today>.html`. If it does not exist, the
scheduled scan has not run; offer to run it now:

```bash
npm run scan && node daily-digest.mjs
```

Summarise the top 10 in chat as a compact table: rank, role, company, salary (or
"undisclosed"), posted date. Say plainly how many roles were found and whether
any source failed.

## Step 2 — Let the candidate choose

Ask which roles they want to pursue. Accept several. Do not evaluate anything
they did not pick — evaluation is the expensive step.

## Step 3 through Step 7 — Per-Job Cycle (Evaluate, Tailor, Apply)

**CRITICAL:** Steps 3 through 7 form a complete per-job cycle that must finish
entirely for ONE job — including both approval gates and submission — before
moving to the next job. Gates are never batched across jobs. Approval for one
job never carries to another.

Work through the candidate's picks one at a time. The entire 3-7 cycle repeats
from the top for each pick only after the current one has been submitted or
abandoned.

### Step 3 — Evaluate and verify

For the role currently in this cycle:

1. Run the career-ops evaluation (`modes/oferta.md` via the `career-ops` skill,
   or `auto-pipeline` from the URL) for the A–F score and the Block G
   scam / ghost-job check.
2. Verify the posting is still live **before** generating anything:
   ```bash
   node check-liveness.mjs "<job url>"
   ```
   If it is dead, say so and drop it. Do not spend a tailored CV on a closed role.
3. Report the A–F score. If it is below 4.0, say so and recommend against
   applying — but the decision is the candidate's.

### Step 4 — Generate material — GATE 1

Generate the tailored CV and cover letter by running the tailoring workflows:

1. **Tailored CV:** Run `modes/pdf.md` to rewrite the CV using the job description
   keywords and role-specific framing, then execute its final render step:
   ```bash
   node generate-pdf.mjs <input.html> output/cv-<candidate>-<company>-<date>.pdf [--format=letter|a4]
   ```
2. **Tailored cover letter:** Run `modes/cover.md` to draft the letter. When done,
   generate the PDF:
   ```bash
   node generate-cover-letter.mjs --payload payload.json [--out output/path.pdf]
   ```

Show the candidate both outputs, then **STOP**. Do not open a form until they
approve this material. If they want changes, revise and show again.

### Step 5 — Fill the form

Only after gate 1 passes.

1. Ask the candidate to open the application page in their browser and confirm
   they are logged in. Never log in yourself.
2. Read the form and enumerate **every** question.
3. Run the `modes/apply.md` preflight: confirm the visible company and role
   match the evaluated report. On a material mismatch, stop and ask whether to
   re-evaluate, adapt, or abort.
4. For each question, resolve an answer in this order:
   - `matchAnswer` against `data/answers.yml`:
     ```bash
     node -e "import('./answers.mjs').then(m=>{const a=m.loadAnswers();console.log(JSON.stringify(m.matchAnswer(a,process.argv[1]),null,2))})" "<question text>"
     ```
   - `scope: universal` → fill its `a` verbatim.
   - `scope: per-job` → draft fresh from this job's report. Never reuse a stale
     per-job answer. Apply `voice-dna.md`.
   - **No match** → ask the candidate. Then persist it so it is never asked
     again. Which of the two forms below you use depends on whether the answer
     is job-independent. Both compute today's date using the candidate's
     timezone (same as the digest filename).

     **(a) Job-independent answer** (notice period, visa status, years of
     experience) → store the answer with `scope: universal`. It will be filled
     verbatim, at every future employer:
     ```bash
     node -e "Promise.all([import('./daily-digest.mjs'),import('js-yaml')]).then(async([d,y])=>{const {readFileSync}=await import('fs');console.log(d.digestDate(y.default.load(readFileSync('config/profile.yml','utf8'))))})" | xargs -I{} node -e "import('./answers.mjs').then(m=>m.appendAnswer({q:process.argv[1],match:JSON.parse(process.argv[2]),scope:'universal',a:process.argv[3],updated:process.argv[4]}))" "<q>" '["token1","token2"]' "<answer>" "{}"
     ```

     **(b) Employer-specific question** ("Why do you want to join us?", "Which
     of our products…?") → store the **QUESTION ONLY**, with `scope: per-job`
     and **no `a` field at all**. The store then remembers that the question
     exists and how to recognise it, and the answer is drafted fresh from that
     job's report every single time:
     ```bash
     node -e "Promise.all([import('./daily-digest.mjs'),import('js-yaml')]).then(async([d,y])=>{const {readFileSync}=await import('fs');console.log(d.digestDate(y.default.load(readFileSync('config/profile.yml','utf8'))))})" | xargs -I{} node -e "import('./answers.mjs').then(m=>m.appendAnswer({q:process.argv[1],match:JSON.parse(process.argv[2]),scope:'per-job',updated:process.argv[3]}))" "<q>" '["token1","token2"]' "{}"
     ```
     Form (a) with `scope: per-job` would throw — `answers.mjs` rejects a
     per-job entry that carries an `a`. That rejection is deliberate, and form
     (b) is the way to satisfy it, not a workaround.

     **NEVER store an employer-specific answer as `universal`.** A universal
     entry is auto-filled verbatim, so "I want to join Acme because…" would be
     typed into the next company's form — visibly wrong to the reader, and the
     kind of error that ends an application.

     Choose `match` tokens that are specific enough not to collide with an
     existing entry.
5. Fill the fields. State which `answers.yml` entry matched each one, so a
   wrong match is visible rather than silent.

### Step 6 — Review and submit — GATE 2

1. Present every filled field for review, plus anything left blank.
2. **STOP.** Wait for explicit approval of *this* application.
3. On approval, click submit. On a CAPTCHA, stop and hand over.
4. If they want edits, change them and present again.

### Step 7 — Record and report

After a confirmed submission, mark the row the Step 3 evaluation already wrote.

**Do NOT reserve a report number. Do NOT write a TSV. Do NOT run
`merge-tracker.mjs`.** Step 3's evaluation (`modes/oferta.md`) already reserved,
used and released a report number and already merged a tracker row for this
company and role, with status `Evaluated` and the A–F score. A second report
number would point at a file that does not exist, and `merge-tracker.mjs` cannot
change a status at all: it only rewrites an existing row when the new score is
*higher*, and even then it re-uses the old row's status
(`status: duplicate.status`). A TSV saying `Applied` would be silently skipped —
your application would go unrecorded with no error.

Recording is therefore an in-place **update**:

1. Find the existing row for this company + role in `data/applications.md` — the
   one the Step 3 evaluation wrote. Match on company and role.
2. Edit exactly two cells of that row:
   - **Status** → `Applied` (canonical, no bold, no date, no extra text).
   - **Notes** → append the submission date and the job URL, e.g.
     `Applied 2026-08-21. https://sg.jobstreet.com/job/94049727`, keeping
     whatever the notes already said.
   The URL in Notes is not decoration: `daily-digest.mjs` reads applied URLs out
   of the Notes cell of applied rows. Omit it and the role reappears at the top
   of tomorrow's digest under a heading that says you have not applied to it.
3. Preserve **every** other cell byte-for-byte — number, date, company, role,
   score, PDF flag, and the existing report link. The tracker's column order is
   `# | Date | Company | Role | Score | Status | PDF | Report | Notes`.
4. **Never add a new row here.** `CLAUDE.md` rule 1 is absolute: *"NEVER edit
   applications.md to ADD new entries"* — additions go through a TSV and
   `merge-tracker.mjs`. This step is permitted only because rule 2 says
   *"YES you can edit applications.md to UPDATE status/notes of existing
   entries"*, and `Evaluated` → `Applied` is precisely that update.
5. If **no** matching row exists (the Step 3 evaluation was skipped, or the
   company/role differ from what was evaluated), **stop and tell the candidate**
   what you could not find. Do not invent a row, and do not fall back to writing
   a TSV. The application is already submitted; the honest fix is for the
   candidate to decide whether to run the evaluation now or record it by hand.

Then regenerate the digest so it reflects the submission — the applied role
drops out of the list and appears in the "Applied today" section:

```bash
node daily-digest.mjs
```

Finally, give the candidate the digest path and a one-line summary of what was
submitted.

## When something goes wrong

| Situation | Do this |
|-----------|---------|
| Digest missing | Offer to run the scan; do not fabricate a list |
| A source failed | Say which one. A short list may be a failure, not a quiet market |
| Posting dead | Drop it before generating material |
| CAPTCHA | Stop, hand over, never attempt it |
| Login wall | Stop, ask them to log in, never touch credentials |
| Company/role mismatch | Stop before drafting; ask how to proceed |
| Form question you cannot answer | Ask. Never guess on a real application |
| `answers.yml` fails to load | Stop. Report the error. Never proceed with an empty store — that would blank out real answers |
| No tracker row to update in Step 7 | Stop and say so. Never add a row and never write a TSV (see Step 7) |
| Digest shorter after regenerating | `node daily-digest.mjs` re-fetches every portal entry, so a mid-cycle rate limit can replace the morning's list with a shorter one. Check the failures box before reading it as a quiet market; the morning file is gone once overwritten |
