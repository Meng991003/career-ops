---
name: job-tailor
description: Build a tailored CV PDF and cover letter for one specific role from cv.md, without running the whole apply routine. Use when the user wants documents for a job they name or paste, asks to regenerate their general resume, or wants an existing tailored CV revised.
user_invocable: true
---

# Job Tailor — CV and cover letter for one role

Produces the documents only. It does not evaluate, open a form, or apply —
that is `daily-jobs`, under its two approval gates.

Read `modes/_shared.md` and `modes/_profile.md` first: they carry the archetypes
and the `voice-dna.md` anti-slop rules that all candidate-facing text must obey.

## Never invent a résumé fact

Every claim must trace to `cv.md`, `config/profile.yml` or `data/answers.yml`.
If a job wants something the candidate lacks, name the gap honestly in the
cover letter rather than implying coverage. At exactly the years a posting asks
for, there is no seniority cushion to survive a discovered overclaim.

## 1. Write a tailoring spec — do not hand-author HTML

```bash
cp tailor/general.yml tailor/<company>.yml
```

The spec carries only what CHANGES for this role: `summary`, `competencies`,
`skills` (an ordered map), and per-job `bullets`. Everything omitted falls back
to `cv.md`, so a near-empty spec yields a faithful general CV. `projects: false`
drops the Projects section where it earns nothing.

`build-cv.mjs` takes every fact from `cv.md` — name, contact, job headings,
periods, locations, default bullets, education — so the spec cannot fabricate
history. It throws if the spec names a company `cv.md` does not contain.

Tailoring means selecting and reframing what is already true: lead with what the
JD names, drop what earns nothing, keep the wording defensible.

## 2. Build and render

```bash
node build-cv.mjs tailor/<company>.yml --out /tmp/cv-<company>.html
node generate-pdf.mjs /tmp/cv-<company>.html output/cv-<candidate>-<company>-<date>.pdf --format=a4
```

`generate-pdf.mjs` validates the rendered section order against `cv.md` and
refuses to build on a mismatch. That check is doing its job — fix the order,
do not work around it. Run `node build-cv.mjs --self-check` if `cv.md`'s
structure changed.

## 3. Cover letter

Draft via `modes/cover.md`, then:

```bash
node generate-cover-letter.mjs --payload <payload>.json [--out output/<name>.pdf]
```

Required keys: `candidate.name`, `letter.role_title`, `letter.opening`,
`letter.profile_intro`. State work-authorisation and notice period plainly in
the closing where they apply.

## 4. Verify before showing it

Read the PDF back rather than trusting the build:

```bash
node --input-type=module -e "
import {readFileSync} from 'node:fs';
const {extractText}=await import('./server/lib/resume-extract.mjs');
const t=await extractText(readFileSync(process.argv[1]),'x.pdf');
const banned=['NestJS','CI/CD','C++'];
console.log('false claims:', banned.filter(k=>t.includes(k)).join(', ')||'none');
console.log('pages of text:', t.length, 'chars');
" output/cv-<candidate>-<company>-<date>.pdf
```

Check the claims the CV deliberately excludes are still absent, that role-critical
keywords are present, and that each skill line renders on its own row. Then show
the user both files and stop.

## When something goes wrong

| Situation | Do this |
|-----------|---------|
| Section order rejected | Match the rendered order to `cv.md`'s own order; the validator compares only the sections it recognises |
| Two skill lines share a row | The template's `.skills-grid` is a wrapping flexbox; `build-cv.mjs` already forces one per row, so a shared row means hand-edited HTML |
| A spec references an unknown company | It throws by design — fix the spec or add the role to `cv.md` first |
| Text field rejects the content | Employer forms cap silently (a 100-char compensation field). Shorten preserving meaning, then re-verify every other field |
| Em dash appears in candidate-facing text | Banned by `voice-dna.md`; use a colon or restructure |
