#!/usr/bin/env node
// @ts-check
/**
 * daily-digest-tests.mjs — unit tests for daily digest ranking and rendering.
 * Run: node daily-digest-tests.mjs
 */

import { scoreJob, rankJobs, renderDigest, parseAppliedUrls, parsePendingUrls } from './daily-digest.mjs';

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

const APPLIED_MD = `| Date | Company | Role | URL | Status |
|---|---|---|---|---|
| 2026-08-19 | Acme | Software Engineer | https://sg.jobstreet.com/job/111 | Applied |
`;
const applied = parseAppliedUrls(APPLIED_MD);
assert(applied.has('https://sg.jobstreet.com/job/111'), 'applied url captured from the tracker table');
assert(parseAppliedUrls('').size === 0, 'empty tracker → empty set');

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

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
