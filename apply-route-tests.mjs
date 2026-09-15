#!/usr/bin/env node
// @ts-check
// Tests for apply-route.mjs — the Singpass/MyCareersFuture route check.
//
// Run: node apply-route-tests.mjs
//
// The MCF lookup is stubbed. What matters here is the classification and the
// never-drop / never-false-clear behaviour, not the network.

import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  classifyApplyUrl,
  normalizeCompany,
  isSgBoardUrl,
  companyPostsOnMcf,
  annotateApplyRoute,
  saveCache,
  loadCache,
} from './apply-route.mjs';

let passed = 0;
const check = (name, fn) => {
  try {
    fn();
    passed++;
  } catch (err) {
    console.error(`FAIL: ${name}\n  ${err.message}`);
    process.exitCode = 1;
  }
};
const checkAsync = async (name, fn) => {
  try {
    await fn();
    passed++;
  } catch (err) {
    console.error(`FAIL: ${name}\n  ${err.message}`);
    process.exitCode = 1;
  }
};

// ── classifyApplyUrl: the exact foundit signal ──────────────────────

check('MCF apply URL is gated', () => {
  assert.equal(
    classifyApplyUrl('https://www.mycareersfuture.gov.sg/job/906adbc374a502182999eb632ef94484?utm_source=Monster'),
    'gated',
  );
});

check('MCF subdomain is gated', () => {
  assert.equal(classifyApplyUrl('https://api.mycareersfuture.gov.sg/job/x'), 'gated');
});

check('a company ATS apply URL is open', () => {
  assert.equal(classifyApplyUrl('https://jobs.lever.co/acme/123/apply'), 'open');
});

check('a lookalike host is NOT gated', () => {
  // Guards the endsWith check against `mycareersfuture.gov.sg.evil.com`.
  assert.equal(classifyApplyUrl('https://mycareersfuture.gov.sg.evil.com/job/1'), 'open');
});

check('missing or malformed apply URL is unknown, not open', () => {
  assert.equal(classifyApplyUrl(undefined), 'unknown');
  assert.equal(classifyApplyUrl(''), 'unknown');
  assert.equal(classifyApplyUrl('not a url'), 'unknown');
});

// ── normalizeCompany: board display name vs MCF legal name ──────────

check('MCF upper-case legal name matches the board display name', () => {
  assert.equal(
    normalizeCompany('GOLDTECH RESOURCES PTE LTD'),
    normalizeCompany('Goldtech Resources Pte Ltd'),
  );
});

check('entity suffixes and parentheticals are stripped', () => {
  assert.equal(normalizeCompany('Ambition (SG) Pte Ltd'), 'ambition');
  assert.equal(normalizeCompany('UEMS Solutions Pte Ltd'), 'uemssolutions');
});

check('distinct companies do not collapse together', () => {
  assert.notEqual(normalizeCompany('Capgemini'), normalizeCompany('Goldtech Resources'));
});

// ── isSgBoardUrl ────────────────────────────────────────────────────

check('SG board hosts are in scope, others are not', () => {
  assert.equal(isSgBoardUrl('https://sg.jobstreet.com/job/94081791'), true);
  assert.equal(isSgBoardUrl('https://www.foundit.sg/job/x-123'), true);
  assert.equal(isSgBoardUrl('https://my.jobstreet.com/job/1'), false);
  assert.equal(isSgBoardUrl('https://boards.greenhouse.io/acme/jobs/1'), false);
  assert.equal(isSgBoardUrl('garbage'), false);
});

// ── companyPostsOnMcf: must check postedCompany, not `total` ────────

await checkAsync('a free-text hit on another company is NOT a match', async () => {
  // MCF's search matches description text, so a non-zero `total` says nothing
  // about THIS advertiser. This is the bug the postedCompany filter prevents.
  const fetchJson = async () => ({ total: 1033, results: [
    { title: 'Java Developer', postedCompany: { name: 'SOME OTHER FIRM PTE LTD' } },
  ] });
  assert.equal(await companyPostsOnMcf('Goldtech Resources Pte Ltd', fetchJson), false);
});

await checkAsync('a real postedCompany hit matches', async () => {
  const fetchJson = async () => ({ total: 99, results: [
    { title: 'HR Operations Specialist', postedCompany: { name: 'GOLDTECH RESOURCES PTE LTD' } },
  ] });
  assert.equal(await companyPostsOnMcf('Goldtech Resources Pte Ltd', fetchJson), true);
});

await checkAsync('a failed lookup returns null, never false', async () => {
  // false would render as "open" — a confident all-clear built on an outage.
  const fetchJson = async () => { throw new Error('ECONNRESET'); };
  assert.equal(await companyPostsOnMcf('Capgemini', fetchJson), null);
});

// ── annotateApplyRoute ──────────────────────────────────────────────

const cachePath = join(tmpdir(), `mcf-cache-test-${process.pid}.json`);

await checkAsync('never drops a job, whatever happens', async () => {
  const jobs = [
    { url: 'https://sg.jobstreet.com/job/1', company: 'Capgemini' },
    { url: 'https://sg.jobstreet.com/job/2', company: '' },
    { url: 'https://boards.greenhouse.io/acme/jobs/3', company: 'Acme' },
  ];
  const fetchJson = async () => { throw new Error('down'); };
  const out = await annotateApplyRoute(jobs, { fetchJson, cache: {} });
  assert.equal(out.length, 3);
  assert.ok(out.every(j => typeof j.applyRoute === 'string'));
});

await checkAsync('an MCF outage yields unknown, not open', async () => {
  const jobs = [{ url: 'https://sg.jobstreet.com/job/1', company: 'Capgemini' }];
  const fetchJson = async () => { throw new Error('down'); };
  await annotateApplyRoute(jobs, { fetchJson, cache: {} });
  assert.equal(jobs[0].applyRoute, 'unknown');
});

await checkAsync('an advertiser on MCF is flagged likely-gated', async () => {
  const jobs = [{ url: 'https://sg.jobstreet.com/job/1', company: 'Capgemini' }];
  const fetchJson = async () => ({ results: [{ postedCompany: { name: 'CAPGEMINI SINGAPORE PTE LTD' } }] });
  await annotateApplyRoute(jobs, { fetchJson, cache: {} });
  assert.equal(jobs[0].applyRoute, 'likely-gated');
});

await checkAsync('an advertiser absent from MCF is open', async () => {
  const jobs = [{ url: 'https://sg.jobstreet.com/job/1', company: 'UEMS Solutions Pte Ltd' }];
  const fetchJson = async () => ({ results: [] });
  await annotateApplyRoute(jobs, { fetchJson, cache: {} });
  assert.equal(jobs[0].applyRoute, 'open');
});

await checkAsync('an exact provider signal is never overwritten by inference', async () => {
  // foundit already resolved this one from the posting's own apply URL.
  const jobs = [{ url: 'https://www.foundit.sg/job/x-1', company: 'Recruit Express', applyRoute: 'gated' }];
  let called = false;
  const fetchJson = async () => { called = true; return { results: [] }; };
  await annotateApplyRoute(jobs, { fetchJson, cache: {} });
  assert.equal(jobs[0].applyRoute, 'gated');
  assert.equal(called, false, 'should not spend a lookup on an already-exact answer');
});

await checkAsync('one lookup per advertiser, not per job', async () => {
  const jobs = [
    { url: 'https://sg.jobstreet.com/job/1', company: 'Manpower Singapore' },
    { url: 'https://sg.jobstreet.com/job/2', company: 'Manpower Singapore' },
    { url: 'https://sg.jobstreet.com/job/3', company: 'MANPOWER SINGAPORE PTE LTD' },
  ];
  let calls = 0;
  const fetchJson = async () => { calls++; return { results: [{ postedCompany: { name: 'MANPOWER SINGAPORE PTE LTD' } }] }; };
  await annotateApplyRoute(jobs, { fetchJson, cache: {} });
  assert.equal(calls, 1, `expected 1 MCF call, made ${calls}`);
  assert.ok(jobs.every(j => j.applyRoute === 'likely-gated'));
});

await checkAsync('the lookup cap degrades to unknown rather than dropping rows', async () => {
  const jobs = [
    { url: 'https://sg.jobstreet.com/job/1', company: 'Alpha' },
    { url: 'https://sg.jobstreet.com/job/2', company: 'Beta' },
  ];
  const fetchJson = async () => ({ results: [] });
  await annotateApplyRoute(jobs, { fetchJson, cache: {}, max: 1 });
  assert.equal(jobs[0].applyRoute, 'open');
  assert.equal(jobs[1].applyRoute, 'unknown');
});

check('a corrupt cache file reads as empty rather than throwing', () => {
  saveCache({ acme: { onMcf: true, checkedAt: Date.now() } }, cachePath);
  assert.deepEqual(loadCache('/nonexistent/path/nope.json'), {});
  assert.ok(loadCache(cachePath).acme);
});

console.log(`apply-route: ${passed} checks passed`);
