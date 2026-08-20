---
name: daily-jobs
description: Daily Singapore job routine — review the morning digest, tailor material for chosen roles, and assist the application under two approval gates. Use when the user wants to review today's jobs, apply to a role, or asks about their job search pipeline.
user_invocable: true
---

# Daily Jobs — Singapore Routine

Read `modes/_shared.md` and `modes/_profile.md` FIRST. They carry the scoring
rules, sources of truth, and the `voice-dna.md` anti-slop guardrail that all
candidate-facing text must obey.

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

### Step 3 — Evaluate and verify

For each picked role, in order:

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
     again. Compute today's date using the candidate's timezone (same as the
     digest filename):
     ```bash
     node -e "Promise.all([import('./daily-digest.mjs'),import('js-yaml')]).then(async([d,y])=>{const {readFileSync}=await import('fs');console.log(d.digestDate(y.default.load(readFileSync('config/profile.yml','utf8'))))})" | xargs -I{} node -e "import('./answers.mjs').then(m=>m.appendAnswer({q:process.argv[1],match:JSON.parse(process.argv[2]),scope:process.argv[3],a:process.argv[4],updated:process.argv[5]}))" "<q>" '["token1","token2"]' universal "<answer>" "{}"
     ```
     Choose `match` tokens that are specific enough not to collide with an
     existing entry. Prefer `universal` only when the answer is genuinely
     job-independent.
5. Fill the fields. State which `answers.yml` entry matched each one, so a
   wrong match is visible rather than silent.

### Step 6 — Review and submit — GATE 2

1. Present every filled field for review, plus anything left blank.
2. **STOP.** Wait for explicit approval of *this* application.
3. On approval, click submit. On a CAPTCHA, stop and hand over.
4. If they want edits, change them and present again.

### Step 7 — Record and report

After a confirmed submission:

1. Reserve a report number:
   ```bash
   node reserve-report-num.mjs
   ```
2. Write a single-line TSV to `batch/tracker-additions/{num}-{company-slug}.tsv`
   with these 9 tab-separated columns (in order):
   ```
   {num}	{date}	{company}	{role}	Applied	{score}/5	{pdf_emoji}	[{num}](reports/{num}-{slug}-{date}.md)	{note}
   ```
   - `date` is YYYY-MM-DD
   - `score` is the A-F evaluation score formatted `X.X/5`
   - `pdf_emoji` is ✅ or ❌
   - Report link is always root-relative `[num](reports/...)`; merge-tracker.mjs rewrites it
   - Use the existing company+role if it already exists in applications.md — update it rather than duplicating
3. Merge into the tracker:
   ```bash
   node merge-tracker.mjs
   ```
4. Regenerate the digest so it reflects the submission:
   ```bash
   node daily-digest.mjs
   ```
5. Give the candidate the digest path and a one-line summary of what was
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
