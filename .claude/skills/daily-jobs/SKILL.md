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

**Companion skills.** This one owns the gated apply cycle. `job-search` runs a
fresh scan and presents the digest; `job-tailor` builds documents for a single
role without the gates; `job-profile-sync` reconciles JobStreet and foundit
against `cv.md`. Invoke those directly when the user wants only that part.

**After editing any of these skills, run `npm run test-skills`.** It checks that
every script, file and named export a skill tells an agent to use actually
exists and is importable. Skills are written from memory and then trusted; this
is what catches a command that was wrong the moment it was written, rather than
mid-application. It verifies existence only — a wrong subcommand or flag on a
real script still needs a human to read that script.

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
scheduled scan has not run — use the **`job-search`** skill to produce one
rather than reproducing its steps here. It also covers what to do when the user
suspects a whole category of role is missing from the results.

Summarise **each source section separately** in chat as a compact table: rank,
role, company, salary (or "undisclosed"), posted date. The digest currently
carries four sections — JobStreet, LinkedIn Easy Apply, LinkedIn apply-on-company-site,
and foundit — each ranked independently so a source with fewer priced listings
is not crowded out of one combined list. Say plainly how many roles were found
per source and whether any source failed.

**Numbering repeats across sections**, so a bare number is ambiguous. Always
identify a role by source and rank together (for example "JS7" or "foundit 3"),
and ask which the candidate means if they give only a digit.

## Step 2 — Let the candidate choose

Ask which roles they want to pursue. Accept several. Do not evaluate anything
they did not pick — evaluation is the expensive step.

**Encourage two or three picks rather than one.** Most of the cost of an
application is per-session, not per-job: browser setup, ATS quirks, and the
answers that are missing from `data/answers.yml`. The second application of a
session is markedly cheaper than the first, and cheaper still at the same
employer or on the same ATS. Quality still governs which roles are worth
picking — this is about batching the ones already worth doing, never about
loosening the bar to fill a quota.

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

Generate the tailored CV and cover letter. The **`job-tailor`** skill holds the
full detail (spec format, verification, failure modes); the short form is:

1. **Tailored CV:** write a tailoring spec, then build and render it. Do NOT
   hand-author the HTML — that was the single slowest part of Step 4.

   ```bash
   # 1. copy the nearest existing spec as a starting point
   cp tailor/general.yml tailor/<company>.yml

   # 2. edit it: summary, competencies, skills grouping, per-job bullets.
   #    Anything you omit falls back to cv.md, so only write what CHANGES.

   # 3. build + render
   node build-cv.mjs tailor/<company>.yml --out /tmp/cv-<company>.html
   node generate-pdf.mjs /tmp/cv-<company>.html output/cv-<candidate>-<company>-<date>.pdf --format=a4
   ```

   `build-cv.mjs` takes every fact from `cv.md` (name, contact, job headings,
   periods, locations, default bullets, education) so the spec cannot invent
   résumé facts (rule 4). It throws if the spec names a company `cv.md` does not
   contain, and it forces one skill line per row, which is a template bug you
   would otherwise re-hit on every CV with a short skill line.

   Run `node build-cv.mjs --self-check` if `cv.md`'s structure has changed.
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
   - **No match** → **collect it as an unknown; do not ask yet.** Step 5 asks
     for every unknown at once. When the answer comes back, persist it so it is
     never asked again, using whichever of the two forms below applies. Both
     compute today's date using the candidate's timezone (same as the digest
     filename).

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
5. **Resolve every field BEFORE asking anything.** Walk the whole list from
   step 2, resolve each against `answers.yml`, and collect the unknowns. Then
   ask for **all of them in a single message**, and persist each answer as it
   comes back.

   Asking one gap, filling, discovering the next gap, and asking again costs a
   human round trip per gap. Enumerate first, ask once. If a required field has
   no source anywhere (`answers.yml`, `config/profile.yml`, `cv.md`), it is an
   unknown — do not start filling in the hope it resolves itself.

6. Fill the fields. State which `answers.yml` entry matched each one, so a
   wrong match is visible rather than silent.

   **Upload documents FIRST, then fill text fields.** Some ATSs re-render and
   reload profile data from the account after an upload, wiping anything already
   typed. Verify the full field list immediately before submitting.

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

Then, **if this was the last job of the session**, regenerate the digest so it
reflects the submission — the applied role drops out of the list and appears in
the "Applied today" section:

```bash
node daily-digest.mjs
```

**Working through several jobs? Skip the regeneration until the last one.** Each
run re-fetches every portal entry, so regenerating between jobs costs a full
scan and risks a mid-cycle rate limit replacing the morning's list with a
shorter one. The tracker edit above is what actually records the submission; the
digest is only a view of it.

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
| An ATS button does nothing when clicked | Some ATSs bind handlers that ignore synthetic `ref` clicks. The tell is **zero network requests** and no DOM change after the click. Retry with a real coordinate click (`computer` + `coordinate`) before concluding anything is broken. Confirmed on SAP SuccessFactors (`career5.successfactors.eu`), where Apply, the upload tiles and the source dropdown all needed coordinate clicks while text fields and Expand/Apply accepted refs |
| JobStreet shows **Apply** rather than **Quick apply** | The ad hands off to the employer's own ATS. Expect a different form, an account requirement, and none of the JobStreet answers prefilled |
| An apply URL 301s to the site root | Check a second requisition on the same site before dropping the role. If every requisition does it, it is a site-wide routing quirk and **not** evidence this posting is closed. Confirmed on Sonova, where `/talentcommunity/apply/<id>/` 301s to `/` for every job and `/apply/<id>/` returns a byte-identical contentless shell |
| Submit fails validation on a long answer | ATS text fields cap silently (SuccessFactors compensation field: 100 characters). Shorten while preserving meaning, then **re-verify every other field** — a failed submit can collapse sections and the values need checking, not assuming |
| Filled fields blank out mid-form | An ATS may re-render and reload profile data from the account after a file upload, wiping typed values. Upload documents **first**, fill fields **second**, and verify the full field list immediately before submitting |
