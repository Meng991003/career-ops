#!/usr/bin/env node
// @ts-check
/**
 * daily-digest-tests.mjs — unit tests for daily digest ranking and rendering.
 * Run: node daily-digest-tests.mjs
 */

import { readFileSync, writeFileSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import yaml from 'js-yaml';
import {
  scoreJob, rankJobs, renderDigest, parseAppliedUrls, parseAppliedRows,
  pickAppliedToday, parsePendingUrls, digestDate, collectJobs, skillTokens,
  loadBenchmarks, classifyTitle, lookupBucket, buildRepostIndex,
} from './daily-digest.mjs';
// scan.mjs guards its main() behind an import.meta.url check, so importing it
// here (for buildSalaryFilter, to prove the hard filter never sees an
// estimate) is safe — same reasoning daily-digest.mjs itself documents.
import { buildSalaryFilter } from './scan.mjs';

let passed = 0;
let failed = 0;
function assert(condition, testName) {
  if (condition) { passed++; console.log(`  ✓ ${testName}`); }
  else { failed++; console.error(`  ✗ FAIL: ${testName}`); }
}
function section(name) { console.log(`\n━━━ ${name} ━━━`); }

const PROFILE = {
  target_roles: {
    primary: ['Software Engineer', 'Full Stack Engineer', 'Backend Engineer'],
    archetypes: [
      { name: 'Full Stack Software Engineer (C#/.NET + TypeScript)', fit: 'primary' },
      { name: 'Backend Engineer (.NET / C#)', fit: 'primary' },
      { name: 'AI Engineer', fit: 'stretch' },
    ],
  },
  compensation: { minimum: 'SGD6000' },
};

const NOW = Date.parse('2026-08-20T00:00:00Z');
const job = (over = {}) => ({
  title: 'Software Engineer', url: 'https://sg.jobstreet.com/job/1',
  company: 'Acme', location: 'Singapore', postedAt: NOW, ...over,
});

section('scoreJob');

assert(
  scoreJob(job({ title: 'Full Stack Software Engineer' }), PROFILE, NOW)
  > scoreJob(job({ title: 'Data Entry Clerk' }), PROFILE, NOW),
  'title matching an archetype scores above an unrelated title'
);
assert(
  scoreJob(job({ salary: { min: 84000, max: 96000, currency: 'SGD' } }), PROFILE, NOW)
  > scoreJob(job(), PROFILE, NOW),
  'a salary clearing the floor scores above no salary data'
);
assert(
  scoreJob(job({ postedAt: NOW }), PROFILE, NOW)
  > scoreJob(job({ postedAt: NOW - 60 * 86400000 }), PROFILE, NOW),
  'a fresher posting scores above a 60-day-old one'
);
assert(Number.isFinite(scoreJob(job({ postedAt: undefined }), PROFILE, NOW)), 'missing postedAt still scores');
assert(Number.isFinite(scoreJob(job({ title: '' }), PROFILE, NOW)), 'empty title still scores (no crash)');

section('scoreJob — fix round 1 (skill vocabulary breaks the tie)');

assert(
  scoreJob(job({ title: 'Full Stack Developer C#.NET' }), PROFILE, NOW)
  > scoreJob(job({ title: 'Software Engineer (C / C++)' }), PROFILE, NOW),
  'a C#.NET title outscores a C/C++ title'
);
assert(
  scoreJob(job({ title: 'Backend Engineer (.NET / C#)' }), PROFILE, NOW)
  > scoreJob(job({ title: 'Embedded Software Engineer' }), PROFILE, NOW),
  'a .NET/C# title outscores an embedded-systems title'
);
assert(
  scoreJob(job({ title: 'Full Stack Engineer (React/ NodeJS/ CMS)' }), PROFILE, NOW)
  > scoreJob(job({ title: 'Lead Software Engineer (Optical DSP Photonics)' }), PROFILE, NOW),
  'a React/NodeJS title outscores an optical-photonics title'
);
assert(
  scoreJob(job({ title: 'Mainframe COBOL Programmer' }), PROFILE, NOW)
  < scoreJob(job({ title: 'Software Engineer' }), PROFILE, NOW),
  'a foreign-stack title scores below a bare "Software Engineer"'
);
assert(
  scoreJob(job({ title: 'AI Engineer' }), PROFILE, NOW)
  < scoreJob(job({ title: 'Full Stack Software Engineer' }), PROFILE, NOW),
  'a stretch-archetype title scores below a primary-archetype title'
);
{
  const s1 = scoreJob(job({
    title: 'Embedded Firmware Systems Analyst',
    salary: { min: 20000, max: 30000, currency: 'SGD' },
    postedAt: NOW - 200 * 86400000,
  }), PROFILE, NOW);
  const s2 = scoreJob(job({ title: 'Full Stack Software Engineer' }), PROFILE, NOW);
  assert(s1 >= 0 && s1 <= 100, 'score clamps to 0..100 (foreign-stack, no skill matches, stale, low salary)');
  assert(s2 >= 0 && s2 <= 100, 'score clamps to 0..100 (a strong match)');
}
assert(
  scoreJob(job({ salary: { min: 84000, max: 96000, currency: 'SGD' } }), PROFILE, NOW)
  > scoreJob(job(), PROFILE, NOW),
  'salary and recency terms are unchanged: salary clearing the floor still beats no salary'
);
assert(
  scoreJob(job({ postedAt: NOW }), PROFILE, NOW)
  > scoreJob(job({ postedAt: NOW - 60 * 86400000 }), PROFILE, NOW),
  'salary and recency terms are unchanged: a fresher posting still beats a 60-day-old one'
);

section('scoreJob — fix round 2 (foreign-stack matches on word boundaries)');

const baseline = scoreJob(job({ title: 'Software Engineer' }), PROFILE, NOW);

for (const title of [
  'Software Engineer (C / C++)',
  'Mainframe COBOL Programmer',
  'Embedded Software Engineer',
  'Lead Software Engineer (Optical DSP Photonics)',
  'Salesforce Developer',
  'iOS Engineer (Objective-C)',
]) {
  assert(
    scoreJob(job({ title }), PROFILE, NOW) < baseline,
    `foreign-stack title scores below the bare "Software Engineer" baseline: ${title}`
  );
}

for (const title of [
  'Software Engineer - Great Opportunity',
  'Full Stack Engineer, Career Opportunity',
  'Software Engineer, Community Platform',
  'Software Engineer - Immunity Research Platform',
  'Software Engineer, Philadelphia',
  'Backend Engineer - SWIFT Payments',
  'Software Engineer',
]) {
  assert(
    scoreJob(job({ title }), PROFILE, NOW) >= baseline,
    `innocent title is NOT penalized, scores at or above baseline: ${title}`
  );
}

assert(
  scoreJob(job({ title: 'Software Engineer, C# and TypeScript' }), PROFILE, NOW) >= baseline,
  'a bare "c" inside "C#" does not trigger the foreign-stack penalty'
);

section('scoreJob — fix round 3 (foreign-stack matches plural forms)');

// Each assertion below isolates a single foreign-stack token so a match can
// only come from the token under test — pairing "photonic" with "dsp" (as
// the round-2 regression title does) is exactly what hid this bug.
for (const title of [
  // now penalised: plural forms the trailing lookahead used to reject.
  'Silicon Photonics Engineer',
  'Photonics Design Engineer',
  'Mainframes Support Engineer',
  // still penalised: singular forms and other tokens, regression guards.
  'Optical Photonic Engineer',
  'Software Engineer (C / C++)',
  'Mainframe COBOL Programmer',
  'Embedded Software Engineer',
  'Salesforce Developer',
  'iOS Engineer (Objective-C)',
]) {
  assert(
    scoreJob(job({ title }), PROFILE, NOW) < baseline,
    `foreign-stack title (incl. plurals) scores below the bare "Software Engineer" baseline: ${title}`
  );
}

for (const title of [
  'Software Engineer - Great Opportunity',
  'Full Stack Engineer, Career Opportunity',
  'Software Engineer, Community Platform',
  'Software Engineer - Immunity Research Platform',
  'Software Engineer, Philadelphia',
  'Backend Engineer - SWIFT Payments',
  'Software Engineer, C# and TypeScript',
]) {
  assert(
    scoreJob(job({ title }), PROFILE, NOW) >= baseline,
    `round-2 false positive stays fixed after the plural change: ${title}`
  );
}

section('digestDate');

assert(
  digestDate({ location: { timezone: 'Asia/Kuala_Lumpur' } }, new Date('2026-08-20T23:00:00Z')) === '2026-08-21',
  'a 07:00 Asia/Kuala_Lumpur scheduled run (23:00 UTC the day before) gets the correct local date'
);
assert(
  digestDate({}, new Date('2026-08-20T23:00:00Z')) === '2026-08-20',
  'falls back to the UTC date when profile has no location.timezone'
);
assert(
  digestDate({ location: { timezone: 'Asia/Kuala_Lumpur' } }, new Date('2026-08-21T04:00:00Z')) === '2026-08-21',
  'midday local time is unaffected'
);

const cliSource = readFileSync('daily-digest.mjs', 'utf-8');
assert(
  cliSource.includes('const date = digestDate(profile)'),
  'the CLI derives the digest date via digestDate(profile), not new Date().toISOString()'
);
assert(
  !cliSource.includes('new Date().toISOString().slice(0, 10)'),
  'the CLI no longer stamps the filename with the raw UTC date'
);

section('rankJobs');

const many = Array.from({ length: 25 }, (_, i) => job({ url: `https://sg.jobstreet.com/job/${i}` }));
assert(rankJobs(many, PROFILE, 10).length === 10, 'caps at the limit');
assert(rankJobs(many.slice(0, 4), PROFILE, 10).length === 4, 'fewer than the limit returns what exists (no padding)');
assert(rankJobs([], PROFILE, 10).length === 0, 'empty input → empty output');

const ranked = rankJobs(
  [job({ title: 'Data Entry Clerk', url: 'https://sg.jobstreet.com/job/a' }),
   job({ title: 'Senior Full Stack Software Engineer', url: 'https://sg.jobstreet.com/job/b' })],
  PROFILE, 10
);
assert(ranked[0].title === 'Senior Full Stack Software Engineer', 'sorted by score, highest first');
assert(typeof ranked[0].score === 'number', 'each ranked job carries its score');

section('parseAppliedUrls / parsePendingUrls');

const PENDING_MD = `# Pipeline — Pending URLs

## Pending
- [ ] https://sg.jobstreet.com/job/111 | Acme | Software Engineer
- [ ] https://sg.jobstreet.com/job/222 | Beta | Backend Engineer

## Processed
- [x] https://sg.jobstreet.com/job/999 | Old | Gone
`;
const pending = parsePendingUrls(PENDING_MD);
assert(pending.size === 2, 'reads only the Pending section');
assert(pending.has('https://sg.jobstreet.com/job/111'), 'pending url captured');
assert(!pending.has('https://sg.jobstreet.com/job/999'), 'Processed rows excluded');
assert(parsePendingUrls('').size === 0, 'empty pipeline → empty set');

// The real tracker has NO URL column — its schema is
// # | Date | Company | Role | Score | Status | PDF | Report | Notes
// (merge-tracker.mjs LEGACY_COLMAP, AGENTS.md). The applied URL lives in the
// Notes cell, put there by the daily-jobs playbook when it flips a row to
// Applied. An earlier fixture invented a `| URL |` column, asserting on a shape
// the file cannot have, which hid the fact that the exclusion never fired.
const APPLIED_MD = `# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
| 12 | 2026-08-19 | Acme | Software Engineer | 4.2/5 | Applied | ✅ | [12](../reports/012-acme-2026-08-19.md) | Submitted 2026-08-19. https://sg.jobstreet.com/job/111 |
| 13 | 2026-08-20 | Beta | Backend Engineer | 3.8/5 | Evaluated | ❌ | [13](../reports/013-beta-2026-08-20.md) | Considering. https://sg.jobstreet.com/job/222 |
`;
const applied = parseAppliedUrls(APPLIED_MD);
assert(applied.has('https://sg.jobstreet.com/job/111'), 'url in the Notes of an Applied row is harvested');
assert(!applied.has('https://sg.jobstreet.com/job/222'), 'url in the Notes of an Evaluated row is NOT harvested');
assert(applied.size === 1, 'only applied rows contribute urls');
assert(parseAppliedUrls('').size === 0, 'empty tracker → empty set');

for (const later of ['Responded', 'Interview', 'Offer', 'Rejected']) {
  assert(
    parseAppliedUrls(APPLIED_MD.replace('| Applied |', `| ${later} |`)).has('https://sg.jobstreet.com/job/111'),
    `a later-stage status counts as applied: ${later}`
  );
}
for (const notYet of ['Evaluated', 'Discarded', 'SKIP']) {
  assert(
    parseAppliedUrls(APPLIED_MD.replace('| Applied |', `| ${notYet} |`)).size === 0,
    `a pre-application status does NOT count as applied: ${notYet}`
  );
}

// Column layout is located by header name, not a fixed index (mirroring
// merge-tracker.mjs's detectColumns), so a customized tracker still works.
const APPLIED_WITH_LOCATION = `| # | Date | Company | Role | Location | Score | Status | PDF | Report | Notes |
|---|------|---------|------|----------|-------|--------|-----|--------|-------|
| 12 | 2026-08-19 | Acme | Software Engineer | Singapore | 4.2/5 | Applied | ✅ | [12](../reports/x.md) | Submitted. https://sg.jobstreet.com/job/111 |
| 13 | 2026-08-19 | Beta | Backend Engineer | Singapore | 3.8/5 | Evaluated | ❌ | [13](../reports/y.md) | https://sg.jobstreet.com/job/222 |
`;
const shifted = parseAppliedUrls(APPLIED_WITH_LOCATION);
assert(shifted.has('https://sg.jobstreet.com/job/111'), 'an extra Location column does not break status detection');
assert(!shifted.has('https://sg.jobstreet.com/job/222'), 'the Evaluated row stays excluded under a shifted layout');

// No header row at all → fall back to the documented legacy column indices.
const APPLIED_NO_HEADER = `| 12 | 2026-08-19 | Acme | Software Engineer | 4.2/5 | Applied | ✅ | [12](../reports/x.md) | https://sg.jobstreet.com/job/111 |
`;
assert(
  parseAppliedUrls(APPLIED_NO_HEADER).has('https://sg.jobstreet.com/job/111'),
  'headerless tracker falls back to the legacy column layout'
);

const rows = parseAppliedRows(APPLIED_MD);
assert(rows.length === 1, 'parseAppliedRows returns only applied rows');
assert(rows[0].company === 'Acme' && rows[0].role === 'Software Engineer', 'row carries company and role');
assert(rows[0].date === '2026-08-19', 'row carries the tracker date');

section('pickAppliedToday');

const TODAY_ROWS = [
  { date: '2026-08-20', company: 'Acme', role: 'Software Engineer', urls: ['https://x/1'] },
  { date: '2026-08-19', company: 'Old', role: 'Backend Engineer', urls: ['https://x/2'] },
  { date: '2026-08-20', company: 'NoLink', role: 'Data Engineer', urls: [] },
];
const today = pickAppliedToday(TODAY_ROWS, '2026-08-20');
assert(today.length === 1, 'only rows dated today, and only those carrying a url');
assert(today[0].company === 'Acme' && today[0].title === 'Software Engineer' && today[0].url === 'https://x/1',
  'shaped as {company, title, url} for renderDigest');
assert(pickAppliedToday([], '2026-08-20').length === 0, 'no rows → empty applied section');
assert(pickAppliedToday(TODAY_ROWS, '2026-08-21').length === 0, 'a different date selects nothing');

// Fix round 2: the Date column holds the EVALUATION date (modes/oferta.md),
// preserved byte-for-byte, so it can differ from the day the application was
// actually submitted. Step 7 of the daily-jobs playbook writes the real
// submission date into Notes ("Applied 2026-08-21. https://...").
const NOTES_ROWS = [
  {
    date: '2026-08-18', company: 'Evaluated-Monday-Applied-Today', role: 'Backend Engineer',
    urls: ['https://x/3'], notes: 'Applied 2026-08-20. https://x/3',
  },
  {
    date: '2026-08-20', company: 'Evaluated-Today-Applied-Earlier', role: 'Data Engineer',
    urls: ['https://x/4'], notes: 'Applied 2026-08-18. https://x/4',
  },
  {
    date: '2026-08-20', company: 'NoDateInNotes-MatchesToday', role: 'SRE',
    urls: ['https://x/5'], notes: 'https://x/5',
  },
  {
    date: '2026-08-19', company: 'NoDateInNotes-DoesNotMatch', role: 'QA Engineer',
    urls: ['https://x/6'], notes: 'https://x/6',
  },
];
const todayWithNotes = pickAppliedToday(NOTES_ROWS, '2026-08-20');
assert(
  todayWithNotes.some(r => r.company === 'Evaluated-Monday-Applied-Today'),
  'an earlier Date column with today\'s date in Notes IS selected for today'
);
assert(
  !todayWithNotes.some(r => r.company === 'Evaluated-Today-Applied-Earlier'),
  'today\'s Date column with an earlier date in Notes is NOT selected for today'
);
assert(
  todayWithNotes.some(r => r.company === 'NoDateInNotes-MatchesToday'),
  'no date in Notes falls back to the Date column (matching case)'
);
assert(
  !todayWithNotes.some(r => r.company === 'NoDateInNotes-DoesNotMatch'),
  'no date in Notes falls back to the Date column (non-matching case)'
);

section('renderDigest');

// Interface change (Feature 2 — split the digest by source): renderDigest now
// takes `sections` (an array of {label, jobs}) instead of one combined `jobs`
// list. Single-list callers below adapt by wrapping their jobs in one section.
const html = renderDigest({
  sections: [{ label: 'JobStreet', jobs: rankJobs([job({ salary: { min: 84000, max: 96000, currency: 'SGD' } })], PROFILE, 10) }],
  applied: [{ company: 'Beta', title: 'Backend Engineer', url: 'https://x/1' }],
  failures: ['linkedin-guest: HTTP 429'],
  date: '2026-08-20',
});
assert(/^<!DOCTYPE html>/i.test(html.trim()), 'renders a complete HTML document');
assert(html.includes('2026-08-20'), 'includes the date');
assert(html.includes('Software Engineer'), 'includes the job title');
assert(/triage/i.test(html), 'labels the ranking as triage, not a fit score');
assert(html.includes('linkedin-guest: HTTP 429'), 'names the failed source');
assert(html.includes('Backend Engineer'), 'includes the applied-today section');
assert(/prefers-color-scheme/.test(html), 'is theme-aware');

const noSalary = renderDigest({
  sections: [{ label: 'JobStreet', jobs: rankJobs([job()], PROFILE, 10) }],
  applied: [], failures: [], date: '2026-08-20',
});
assert(/salary undisclosed/i.test(noSalary), 'labels an unpriced job explicitly (no benchmarks -> no estimate)');

const empty = renderDigest({
  sections: [{ label: 'JobStreet', jobs: [] }, { label: 'LinkedIn', jobs: [] }],
  applied: [], failures: [], date: '2026-08-20',
});
assert(/no jobstreet roles/i.test(empty), 'a zero-job section says so in words rather than rendering a blank table');
assert(/no linkedin roles/i.test(empty), 'the second zero-job section says so too');
assert(!/<table/i.test(empty), 'no table markup at all when every section is empty');

assert(
  !renderDigest({
    sections: [{ label: 'JobStreet', jobs: rankJobs([job({ company: '<script>alert(1)</script>' })], PROFILE, 10) }],
    applied: [], failures: [], date: '2026-08-20',
  }).includes('<script>alert(1)</script>'),
  'escapes HTML in job fields'
);

section('scoreJob — fix round 4 (skill tokens match on word boundaries)');

// A profile whose whole vocabulary is generic fragments — exactly the shape the
// real config/profile.yml produces from narrative.superpowers ("across front
// ends and back ends"). A raw substring match let "back" fire inside the single
// word "backend", which SKILL_GENERIC explicitly excludes.
const FRAGMENT_PROFILE = {
  target_roles: { primary: ['Software Engineer'] },
  narrative: { superpowers: ['root cause investigation across front ends and back ends'] },
  compensation: { minimum: 'SGD6000' },
};

assert(
  scoreJob(job({ title: 'Back End Engineer' }), FRAGMENT_PROFILE, NOW)
  > scoreJob(job({ title: 'Backend Engineer' }), FRAGMENT_PROFILE, NOW),
  'a fragment token ("back") matches as a standalone word but NOT inside "backend"'
);
assert(
  scoreJob(job({ title: 'Backend Software Engineer (Java)' }), FRAGMENT_PROFILE, NOW)
  === scoreJob(job({ title: 'Software Engineer (Java)' }), FRAGMENT_PROFILE, NOW),
  'the word "backend" earns no skill credit at all from fragment tokens'
);

// Tokens shorter than 3 characters are dropped outright.
const TINY_PROFILE = {
  target_roles: { primary: ['Software Engineer'] },
  narrative: { superpowers: ['ci cd as on'] },
  compensation: { minimum: 'SGD6000' },
};
assert(
  scoreJob(job({ title: 'Software Engineer (CI/CD, AS/400)' }), TINY_PROFILE, NOW)
  === scoreJob(job({ title: 'Software Engineer' }), TINY_PROFILE, NOW),
  'two-character tokens ("ci", "cd", "as", "on") award no skill marks'
);

// Boundary matching must still find the two symbol/suffix cases the original
// design requires: ".net" inside "C#.Net" and "node" inside "NodeJS".
const STACK_PROFILE = {
  target_roles: { primary: ['Software Engineer'] },
  narrative: { superpowers: ['C#/.NET and Node.js and Vue.js delivery'] },
  compensation: { minimum: 'SGD6000' },
};
const stackBaseline = scoreJob(job({ title: 'Software Engineer' }), STACK_PROFILE, NOW);
for (const title of [
  'Software Engineer (C#.Net)',
  'Senior .NET Developer, Software Engineer',
  'Software Engineer, NodeJS',
  'Software Engineer (Node.js)',
  'Software Engineer, VueJS',
]) {
  assert(
    scoreJob(job({ title }), STACK_PROFILE, NOW) > stackBaseline,
    `boundary matching still credits the candidate's real stack: ${title}`
  );
}
assert(
  scoreJob(job({ title: 'Software Engineer, Sonnet' }), STACK_PROFILE, NOW) === stackBaseline,
  '".net" does not match inside an unrelated word ("Sonnet")'
);

section('scoreJob — fix round 5 (skill-length floor no longer discards c#/s3)');

assert(
  scoreJob(job({ title: 'Senior C# Engineer' }), PROFILE, NOW)
  > scoreJob(job({ title: 'Backend Software Engineer (Java)' }), PROFILE, NOW),
  'a pure C# title outscores a generic Java title'
);
assert(
  scoreJob(job({ title: 'Senior C# Engineer' }), PROFILE, NOW)
  > scoreJob(job({ title: 'Senior Engineer' }), PROFILE, NOW),
  'the "c#" token itself is contributing (stack removed scores lower)'
);

const REAL_PROFILE = yaml.load(readFileSync('config/profile.yml', 'utf-8'));
const realTokens = skillTokens(REAL_PROFILE);
assert(realTokens.has('c#'), 'skillTokens(real profile.yml) includes "c#"');
for (const junk of ['as', 'on', 'ci', 'cd']) {
  assert(!realTokens.has(junk), `skillTokens(real profile.yml) still excludes "${junk}"`);
}

// Regression guard: restoring c#/s3 must not reopen the round-4 saturation
// hole (27/481 real titles reaching full skill marks on junk tokens alone).
// A generic "Backend Software Engineer" (no real stack named) must stay
// below a title genuinely naming three of the candidate's technologies.
assert(
  scoreJob(job({ title: 'Backend Software Engineer' }), PROFILE, NOW)
  < scoreJob(job({ title: 'Full Stack Software Engineer C#/.NET TypeScript' }), PROFILE, NOW),
  'a title with no real stack named still scores below one naming three real skills'
);

section('renderDigest — salary is displayed MONTHLY (annual ÷ 12)');

const salaryHtml = renderDigest({
  sections: [{ label: 'JobStreet', jobs: [{ ...job({ salary: { min: 84000, max: 96000, currency: 'SGD' } }), score: 50 }] }],
  applied: [], failures: [], date: '2026-08-20',
});
assert(salaryHtml.includes('SGD 7,000 – 8,000/mo'), 'an 84k–96k annual range renders as SGD 7,000 – 8,000/mo');
assert(!salaryHtml.includes('84,000') && !salaryHtml.includes('96,000'), 'the annual figures are never printed');

const singleSalaryHtml = renderDigest({
  sections: [{ label: 'JobStreet', jobs: [{ ...job({ salary: { min: 72000, max: 72000, currency: 'SGD' } }), score: 50 }] }],
  applied: [], failures: [], date: '2026-08-20',
});
assert(singleSalaryHtml.includes('SGD 6,000/mo'), 'a single 72k annual value renders as one monthly figure, SGD 6,000/mo');
assert(!singleSalaryHtml.includes('–'), 'a single value renders no range dash');

section('collectJobs');

const fakeCtx = { transport: 'test', fetchJson: async () => { throw new Error('no network in tests'); }, fetchText: async () => { throw new Error('no network in tests'); } };
const passAll = () => true;
const providerOf = (jobs) => ({ id: 'fake', detect: () => null, fetch: async () => jobs });

const A = { title: 'Software Engineer', url: 'https://x/1', company: 'Acme', location: 'Singapore' };
const B = { title: 'Backend Engineer', url: 'https://x/2', company: 'Beta', location: 'Singapore' };

{
  const { jobs, failures } = await collectJobs({
    portals: { tracked_companies: [{ name: 'Fake', provider: 'fake' }] },
    ctx: fakeCtx, pending: new Set(), applied: new Set(['https://x/1']),
    titleOk: passAll, locationOk: passAll, salaryOk: passAll,
    providers: { fake: providerOf([A, B]) },
  });
  assert(jobs.length === 1 && jobs[0].url === 'https://x/2', 'an applied url is excluded from the digest');
  assert(failures.length === 0, 'no failures on a healthy source');
}

{
  // End to end with the real tracker shape: the Applied row's url is excluded,
  // the Evaluated row's url is not.
  const { jobs } = await collectJobs({
    portals: { tracked_companies: [{ name: 'Fake', provider: 'fake' }] },
    ctx: fakeCtx, pending: new Set(),
    applied: parseAppliedUrls(APPLIED_MD),
    titleOk: passAll, locationOk: passAll, salaryOk: passAll,
    providers: {
      fake: providerOf([
        { ...A, url: 'https://sg.jobstreet.com/job/111' },
        { ...B, url: 'https://sg.jobstreet.com/job/222' },
      ]),
    },
  });
  assert(
    jobs.length === 1 && jobs[0].url === 'https://sg.jobstreet.com/job/222',
    'applied-exclusion is driven by the real tracker fixture: Applied dropped, Evaluated kept'
  );
}

{
  const { jobs, failures } = await collectJobs({
    portals: {
      tracked_companies: [
        { name: 'Boom', provider: 'fake' },
        { name: 'Mystery', provider: 'nope' },
        { name: 'Good', provider: 'ok' },
      ],
    },
    ctx: fakeCtx, pending: new Set(), applied: new Set(),
    titleOk: passAll, locationOk: passAll, salaryOk: passAll,
    providers: {
      fake: { id: 'fake', detect: () => null, fetch: async () => { throw new Error('HTTP 429'); } },
      ok: providerOf([A]),
    },
  });
  assert(failures.some(f => f.includes('Boom') && f.includes('HTTP 429')), 'a throwing provider is named in failures');
  assert(failures.some(f => f.includes('Mystery') && f.includes('unknown provider')), 'an unknown provider is named in failures');
  assert(jobs.length === 1, 'one failing source does not lose the healthy source');
}

{
  const { jobs } = await collectJobs({
    portals: { tracked_companies: [{ name: 'Fake', provider: 'fake' }] },
    ctx: fakeCtx, pending: new Set(['https://x/2']), applied: new Set(),
    titleOk: passAll, locationOk: passAll, salaryOk: passAll,
    providers: { fake: providerOf([A, B]) },
  });
  assert(jobs.length === 1 && jobs[0].url === 'https://x/2', 'a non-empty pipeline stays authoritative on what is new');
}

{
  const { jobs } = await collectJobs({
    portals: { tracked_companies: [{ name: 'Off', provider: 'fake', enabled: false }] },
    ctx: fakeCtx, pending: new Set(), applied: new Set(),
    titleOk: passAll, locationOk: passAll, salaryOk: passAll,
    providers: { fake: providerOf([A, B]) },
  });
  assert(jobs.length === 0, 'a disabled entry is skipped');
}

// ── Feature 1: salary imputation for unpriced postings ─────────────

section('loadBenchmarks');

assert(loadBenchmarks('does/not/exist.yml') === null, 'an absent benchmarks file returns null, not a throw');

const benchTmpDir = mkdtempSync(join(tmpdir(), 'daily-digest-bench-'));
const malformedPath = join(benchTmpDir, 'malformed.yml');
writeFileSync(malformedPath, 'buckets: [\n  - key: mid/*\n    low: 6500\n', 'utf-8');
{
  let threw = false;
  try { loadBenchmarks(malformedPath); } catch { threw = true; }
  assert(threw, 'malformed YAML throws rather than silently degrading to no imputation');
}

const REAL_BENCHMARKS = loadBenchmarks('config/salary-benchmarks.yml');
assert(REAL_BENCHMARKS !== null, 'the real config/salary-benchmarks.yml loads');
assert(REAL_BENCHMARKS.buckets.length === 8, 'the real file has 8 buckets');

section('classifyTitle');

assert(
  JSON.stringify(classifyTitle('Senior Full Stack Engineer', REAL_BENCHMARKS)) === JSON.stringify({ band: 'senior', family: 'fullstack' }),
  '"Senior Full Stack Engineer" -> senior/fullstack'
);
assert(
  JSON.stringify(classifyTitle('Software Engineer', REAL_BENCHMARKS)) === JSON.stringify({ band: 'mid', family: 'general' }),
  '"Software Engineer" -> mid/general (nothing matches)'
);
assert(
  JSON.stringify(classifyTitle('DevOps Engineer', REAL_BENCHMARKS)) === JSON.stringify({ band: 'mid', family: 'devops' }),
  '"DevOps Engineer" -> mid/devops'
);
assert(
  JSON.stringify(classifyTitle('Graduate Software Engineer', REAL_BENCHMARKS)) === JSON.stringify({ band: 'junior', family: 'general' }),
  '"Graduate Software Engineer" -> junior/general'
);
for (const title of ['Email Marketing Engineer', 'Mailing List Software Engineer']) {
  assert(
    classifyTitle(title, REAL_BENCHMARKS).family !== 'data',
    `"${title}" does not classify as data — the " ai " pattern must not match the "ai" hiding inside "email"/"mailing"`
  );
}

section('lookupBucket');

assert(lookupBucket('anything', null) === null, 'returns null when benchmarks is null');
assert(lookupBucket('DevOps Engineer', REAL_BENCHMARKS).key === 'mid/devops', 'resolves an exact "<band>/<family>" bucket when one exists');
assert(lookupBucket('Software Engineer', REAL_BENCHMARKS).key === 'mid/*', 'falls back to "<band>/*" when no exact "<band>/<family>" bucket exists');

const NO_WILDCARD_BENCHMARKS = {
  buckets: [{ key: 'mid/devops', low: 1, high: 2, confidence: 'high' }],
  default: { low: 5000, high: 8000, confidence: 'low' },
  classify: { bands: {}, families: {} },
};
assert(
  lookupBucket('Software Engineer', NO_WILDCARD_BENCHMARKS).key === 'default',
  'falls all the way back to the global default when neither an exact nor a "<band>/*" bucket exists'
);

section('scoreJob — salary imputation tiers (Feature 1)');

// A minimal benchmarks fixture per tier, so only the salary term varies
// against the SAME base title/profile/now used everywhere else in this file.
function mkBenchmarks(low, high, confidence) {
  return {
    buckets: [{ key: 'mid/*', low, high, source: 'test', confidence, note: '' }],
    default: { low: 5000, high: 8000, confidence: 'low' },
    classify: { bands: {}, families: {} },
  };
}

const tierJob = (over = {}) => job({ title: 'Software Engineer', ...over });

const postedAbove = scoreJob(tierJob({ salary: { min: 84000, max: 96000, currency: 'SGD' } }), PROFILE, NOW);
const postedBelow = scoreJob(tierJob({ salary: { min: 48000, max: 60000, currency: 'SGD' } }), PROFILE, NOW);
// floor = SGD6000/month = 72000/year (PROFILE.compensation.minimum). Bucket
// values below are MONTHLY, exactly like the real benchmarks file.
const estimatedHigh = scoreJob(tierJob(), PROFILE, NOW, mkBenchmarks(6500, 9500, 'high')); // 78k-114k annualized: clears
const estimatedMedium = scoreJob(tierJob(), PROFILE, NOW, mkBenchmarks(6500, 9500, 'medium'));
const estimatedLow = scoreJob(tierJob(), PROFILE, NOW, mkBenchmarks(6500, 9500, 'low'));
const straddles = scoreJob(tierJob(), PROFILE, NOW, mkBenchmarks(5000, 7000, 'high')); // 60k-84k annualized: straddles 72k
const estimatedBelow = scoreJob(tierJob(), PROFILE, NOW, mkBenchmarks(3000, 4000, 'high')); // 36k-48k annualized: below
const noBenchmarks = scoreJob(tierJob(), PROFILE, NOW, null);

assert(postedAbove > estimatedHigh, 'posted-above outscores estimated-high');
assert(estimatedHigh > estimatedMedium, 'estimated-high outscores estimated-medium');
assert(estimatedMedium > estimatedLow, 'estimated-medium outscores estimated-low');
assert(estimatedLow > straddles, 'estimated-low outscores straddles (genuinely unknown)');
assert(straddles === noBenchmarks, 'straddling the floor scores exactly the same as having no benchmarks at all');
assert(straddles > estimatedBelow, 'straddles outscores an estimate that is entirely below the floor');
assert(estimatedBelow > postedBelow, 'an estimate entirely below the floor still outscores a POSTED figure below the floor');
for (const [name, score] of [
  ['estimated-high', estimatedHigh], ['estimated-medium', estimatedMedium], ['estimated-low', estimatedLow],
  ['straddles', straddles], ['estimated-below', estimatedBelow],
]) {
  assert(score < postedAbove, `${name} never scores as high as a posted-above figure`);
  assert(score > 0, `${name} never scores 0 — an estimate must never bury a job the way a real below-floor salary does`);
}

// Unit safety: a bucket of monthly 6500-9500 against a 6000/month floor must
// count as CLEARING. A monthly/annual unit slip (comparing bucket.low bare
// against floorAnnual, e.g. `6500 >= 72000`) would read as false and wrongly
// rank this bucket with the entirely-below-floor tier instead of the highest
// estimate tier — this assertion fails under that bug.
assert(
  estimatedHigh > straddles && estimatedHigh > estimatedBelow,
  'a monthly 6500-9500 bucket against a 6000/month floor scores in the "clears" tier, not the "below floor" tier'
);

section('collectJobs — the hard filter never sees an estimate (Feature 1)');

{
  // No salary field at all, and its title's benchmark bucket (junior, entirely
  // below the 6000/month floor per the real config) would fail the hard
  // filter if it were ever handed the estimate. collectJobs must still
  // collect it — the estimate is computed later, only for ranking/rendering.
  const noSalaryJob = { title: 'Junior Software Engineer', url: 'https://x/est-below', company: 'Acme', location: 'Singapore' };
  const salaryFilterOk = buildSalaryFilter({ min: 72000, max: 0, currency: 'SGD' });
  const { jobs: filtered } = await collectJobs({
    portals: { tracked_companies: [{ name: 'Fake', provider: 'fake' }] },
    ctx: fakeCtx, pending: new Set(), applied: new Set(),
    titleOk: passAll, locationOk: passAll, salaryOk: salaryFilterOk,
    providers: { fake: providerOf([noSalaryJob]) },
  });
  assert(
    filtered.length === 1 && filtered[0].url === 'https://x/est-below',
    'a job with no posted salary is collected regardless of what its estimate would say — the hard filter only ever sees job.salary'
  );

  const ranked = rankJobs(filtered, PROFILE, 10, NOW, mkBenchmarks(3000, 4000, 'high'));
  assert(ranked.length === 1, 'a below-floor estimate only affects ranking, never collection — the job still appears, just scored low');
}

// ── Feature 2: split the digest by source ───────────────────────────

section('collectJobs — source tagging');

{
  const { jobs: tagged } = await collectJobs({
    portals: { tracked_companies: [
      { name: 'JS Co', provider: 'jobstreet' },
      { name: 'LI Co', provider: 'linkedin' },
    ] },
    ctx: fakeCtx, pending: new Set(), applied: new Set(),
    titleOk: passAll, locationOk: passAll, salaryOk: passAll,
    providers: {
      jobstreet: providerOf([{ ...A, url: 'https://x/js1' }]),
      linkedin: providerOf([{ ...B, url: 'https://x/li1' }]),
    },
  });
  assert(tagged.find(j => j.url === 'https://x/js1')?.source === 'jobstreet', 'a job from the jobstreet entry is tagged source: "jobstreet"');
  assert(tagged.find(j => j.url === 'https://x/li1')?.source === 'linkedin', 'a job from the linkedin entry is tagged with its own provider id');
}

section('rankJobs / renderDigest — independent per-source sections');

const jsJobs = Array.from({ length: 15 }, (_, i) => job({ url: `https://x/js/${i}`, title: 'Full Stack Software Engineer' }));
const liJobs = Array.from({ length: 3 }, (_, i) => job({ url: `https://x/li/${i}`, title: 'Full Stack Software Engineer' }));
const jsRanked = rankJobs(jsJobs, PROFILE, 10);
const liRanked = rankJobs(liJobs, PROFILE, 10);
assert(jsRanked.length === 10, 'a 15-job source caps at 10 independently');
assert(liRanked.length === 3, 'a 3-job source renders all 3 (no padding, no borrowing from the other source)');

const twoSectionHtml = renderDigest({
  sections: [{ label: 'JobStreet', jobs: jsRanked }, { label: 'LinkedIn', jobs: liRanked }],
  applied: [], failures: [], date: '2026-08-20',
});
assert(twoSectionHtml.indexOf('JobStreet') < twoSectionHtml.indexOf('LinkedIn'), 'the JobStreet section renders before the LinkedIn section');
// Each data row carries exactly two `class="num"` cells (row # and score);
// the header row uses `<th>`, not `<td>`, so this counts data rows only.
assert(
  (twoSectionHtml.match(/<td class="num">/g) || []).length === 13 * 2,
  'both sections together render exactly 13 data rows (10 + 3), independently capped'
);

const oneEmptySectionHtml = renderDigest({
  sections: [{ label: 'JobStreet', jobs: jsRanked }, { label: 'LinkedIn', jobs: [] }],
  applied: [], failures: [], date: '2026-08-20',
});
assert(/no linkedin roles/i.test(oneEmptySectionHtml), 'a zero-job LinkedIn section renders its empty-state wording');
assert(!/no jobstreet roles/i.test(oneEmptySectionHtml), 'the non-empty JobStreet section does not render empty-state wording');

section('renderDigest — estimate labelling and the required notes');

const postedRowJob = { ...job({ url: 'https://x/posted', salary: { min: 84000, max: 96000, currency: 'SGD' } }), score: 70 };
const estimatedRowJob = { ...job({ url: 'https://x/est' }), score: 60, salaryEstimate: { low: 6500, high: 9500, confidence: 'high', bucketKey: 'mid/*' } };

const labelHtml = renderDigest({
  sections: [{ label: 'JobStreet', jobs: [postedRowJob] }, { label: 'LinkedIn', jobs: [estimatedRowJob] }],
  applied: [], failures: [], date: '2026-08-20',
});
assert(labelHtml.includes('SGD 7,000 – 8,000/mo'), 'a posted row renders the plain posted format');
assert(!labelHtml.includes('SGD 7,000 – 8,000/mo (est.)'), 'the posted row never carries the estimate marker');
assert(labelHtml.includes('~SGD 6,500 – 9,500/mo (est.)'), 'an estimated row renders the distinct "~...(est.)" form using the bucket\'s own monthly figures (no /12)');
assert(/not comparable/i.test(labelHtml), 'the cross-section score-incomparability note is present with more than one section');

const oneSectionHtml = renderDigest({
  sections: [{ label: 'JobStreet', jobs: [postedRowJob] }],
  applied: [], failures: [], date: '2026-08-20',
});
assert(!/not comparable/i.test(oneSectionHtml), 'a single-section digest carries no cross-section note — there is nothing to compare');

const staleHtml = renderDigest({
  sections: [{ label: 'JobStreet', jobs: [postedRowJob] }],
  applied: [], failures: [], date: '2026-08-20',
  benchmarks: { meta: { refresh_after: new Date('2020-01-01') } },
});
assert(/stale/i.test(staleHtml) && /refresh_after/i.test(staleHtml), 'a refresh_after in the past surfaces a visible stale-reference note');

const freshHtml = renderDigest({
  sections: [{ label: 'JobStreet', jobs: [postedRowJob] }],
  applied: [], failures: [], date: '2026-08-20',
  benchmarks: { meta: { refresh_after: new Date('2099-01-01') } },
});
assert(!/refresh_after/i.test(freshHtml), 'a refresh_after in the future adds no stale-reference note');

const noBenchmarksHtml = renderDigest({
  sections: [{ label: 'JobStreet', jobs: [postedRowJob] }],
  applied: [], failures: [], date: '2026-08-20', benchmarks: null,
});
assert(!/refresh_after/i.test(noBenchmarksHtml), 'no benchmarks at all -> no stale note either');


section('repost flag (buildRepostIndex + renderDigest column)');
{
  const dir = mkdtempSync(join(tmpdir(), 'repost-'));
  const history = join(dir, 'scan-history.tsv');
  const portals = join(dir, 'portals.yml');
  writeFileSync(portals, 'tracked_companies: []\n');
  // Same role, two distinct URLs, two distinct scan dates => one cluster.
  writeFileSync(history, [
    'url\tfirst_seen\tportal\ttitle\tcompany\tstatus\tlocation',
    'https://sg.linkedin.com/jobs/view/software-engineer-at-acme-4463591545?trk=x\t2026-08-20\tlinkedin-guest-api\tSoftware Engineer\tAcme Inc\tadded\tSingapore',
    'https://sg.linkedin.com/jobs/view/software-engineer-at-acme-4470112233\t2026-09-09\tlinkedin-guest-api\tSoftware Engineer\tAcme Inc\tadded\tSingapore',
    'https://sg.linkedin.com/jobs/view/data-analyst-at-solo-4499887766\t2026-09-09\tlinkedin-guest-api\tData Analyst\tSolo Ltd\tadded\tSingapore',
  ].join('\n') + '\n');

  const index = buildRepostIndex(history, portals);
  assert(index.size === 2, 'both URLs of a repost cluster are indexed');
  assert(!index.has('https://www.linkedin.com/jobs/view/4499887766'),
    'a role seen once is not a repost');

  // Keyed on the canonical posting key, so the tracking param does not matter.
  const reposted = { title: 'Software Engineer', company: 'Acme Inc', location: 'Singapore',
    url: 'https://www.linkedin.com/jobs/view/4463591545/', score: 50 };
  const fresh = { title: 'Data Analyst', company: 'Solo Ltd', location: 'Singapore',
    url: 'https://sg.linkedin.com/jobs/view/data-analyst-at-solo-4499887766', score: 40 };

  const flagged = renderDigest({
    sections: [{ label: 'LinkedIn', jobs: [reposted, fresh] }],
    applied: [], failures: [], date: '2026-09-09', repostIndex: index,
  });
  assert(flagged.includes('<th>Repost</th>'), 'the table has a Repost column');
  assert(/class="repost"[^>]*>2&times;/.test(flagged), 'a reposted role renders its count');
  assert((flagged.match(/class="repost"/g) || []).length === 1,
    'only the reposted role is flagged, not every row in the section');

  // No index => "n/a", never a dash that would read as "checked, clean".
  const unchecked = renderDigest({
    sections: [{ label: 'LinkedIn', jobs: [reposted] }],
    applied: [], failures: [], date: '2026-09-09',
  });
  assert(unchecked.includes('>n/a<'), 'an absent scan history renders n/a, not a clean dash');
  assert(!unchecked.includes('class="repost"'), 'nothing is flagged when the check did not run');

  assert(buildRepostIndex(join(dir, 'missing.tsv'), portals).size === 0,
    'a missing scan history yields an empty index rather than throwing');
}


console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
