#!/usr/bin/env node
// @ts-check
/**
 * daily-digest-tests.mjs — unit tests for daily digest ranking and rendering.
 * Run: node daily-digest-tests.mjs
 */

import { readFileSync } from 'fs';
import {
  scoreJob, rankJobs, renderDigest, parseAppliedUrls, parseAppliedRows,
  pickAppliedToday, parsePendingUrls, digestDate, collectJobs,
} from './daily-digest.mjs';

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

section('renderDigest');

const html = renderDigest({
  jobs: rankJobs([job({ salary: { min: 84000, max: 96000, currency: 'SGD' } })], PROFILE, 10),
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

const noSalary = renderDigest({ jobs: rankJobs([job()], PROFILE, 10), applied: [], failures: [], date: '2026-08-20' });
assert(/salary undisclosed/i.test(noSalary), 'labels an unpriced job explicitly');

const empty = renderDigest({ jobs: [], applied: [], failures: [], date: '2026-08-20' });
assert(/no new roles/i.test(empty), 'empty digest says so rather than rendering a blank table');

assert(
  !renderDigest({
    jobs: rankJobs([job({ company: '<script>alert(1)</script>' })], PROFILE, 10),
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

section('renderDigest — salary is displayed MONTHLY (annual ÷ 12)');

const salaryHtml = renderDigest({
  jobs: [{ ...job({ salary: { min: 84000, max: 96000, currency: 'SGD' } }), score: 50 }],
  applied: [], failures: [], date: '2026-08-20',
});
assert(salaryHtml.includes('SGD 7,000 – 8,000/mo'), 'an 84k–96k annual range renders as SGD 7,000 – 8,000/mo');
assert(!salaryHtml.includes('84,000') && !salaryHtml.includes('96,000'), 'the annual figures are never printed');

const singleSalaryHtml = renderDigest({
  jobs: [{ ...job({ salary: { min: 72000, max: 72000, currency: 'SGD' } }), score: 50 }],
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

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
