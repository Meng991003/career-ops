#!/usr/bin/env node
// @ts-check
/**
 * linkedin-guest-tests.mjs — unit tests for the LinkedIn guest-endpoint parser.
 * Run: node linkedin-guest-tests.mjs
 *
 * Fixture mirrors the real HTML fragment returned by
 * linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search (captured
 * 2026-08-20). The endpoint returns HTML, not JSON.
 */

import linkedinGuest, {
  parseLinkedInCards, parseApplyType, annotateApplyType,
} from './providers/linkedin-guest.mjs';

let passed = 0;
let failed = 0;
function assert(condition, testName) {
  if (condition) { passed++; console.log(`  ✓ ${testName}`); }
  else { failed++; console.error(`  ✗ FAIL: ${testName}`); }
}
function section(name) { console.log(`\n━━━ ${name} ━━━`); }

const CARD = `<li>
  <div class="base-card relative">
    <a class="base-card__full-link" href="https://sg.linkedin.com/jobs/view/software-engineer-at-grab-4432?trk=guest">
      <span class="sr-only">Software Engineer</span>
    </a>
    <h3 class="base-search-card__title">
        Software Engineer
    </h3>
    <h4 class="base-search-card__subtitle">
      <a class="hidden-nested-link" href="https://sg.linkedin.com/company/grab">Grab</a>
    </h4>
    <span class="job-search-card__location">Singapore</span>
    <time class="job-search-card__listdate" datetime="2026-08-19">1 day ago</time>
  </div>
</li>`;

section('parseLinkedInCards — single real card');

const one = parseLinkedInCards(CARD);
assert(one.length === 1, 'one card parsed');
assert(one[0]?.title === 'Software Engineer', 'title trimmed of whitespace');
assert(one[0]?.company === 'Grab', 'company from hidden-nested-link');
assert(one[0]?.location === 'Singapore', 'location extracted');
assert(one[0]?.postedAt === Date.parse('2026-08-19'), 'postedAt from datetime attribute');
assert(
  one[0]?.url === 'https://sg.linkedin.com/jobs/view/software-engineer-at-grab-4432',
  'url extracted and query string stripped'
);

section('parseLinkedInCards — multiple cards');

const three = parseLinkedInCards(CARD + CARD + CARD);
assert(three.length === 3, 'three cards parsed from a concatenated fragment');

section('parseLinkedInCards — resilience');

assert(parseLinkedInCards('').length === 0, 'empty string → empty array');
assert(parseLinkedInCards('<li>no useful content</li>').length === 0, 'card with no title is skipped');
assert(
  parseLinkedInCards(CARD.replace(/<h4[\s\S]*?<\/h4>/, '')).length === 1,
  'missing company does not drop the card'
);
assert(
  parseLinkedInCards(CARD.replace(/<h4[\s\S]*?<\/h4>/, ''))[0].company === '',
  'missing company yields empty string'
);
assert(
  parseLinkedInCards(CARD.replace('https://sg.linkedin.com/jobs/view/software-engineer-at-grab-4432?trk=guest', 'https://evil.example.com/jobs/view/x')).length === 0,
  'non-linkedin href is rejected'
);
assert(
  parseLinkedInCards(CARD + '<li>garbage</li>' + CARD).length === 2,
  'one malformed card does not abort the batch'
);

section('parseLinkedInCards — markup variants');

const CARD_WITH_CLASS = CARD.replace('<li>', '<li class="jobs-search__results-list-item">');
const variant1 = parseLinkedInCards(CARD_WITH_CLASS);
assert(variant1.length === 1, 'card with <li class="..."> tag parses');
assert(variant1[0]?.title === 'Software Engineer', 'variant with class: title matches');
assert(variant1[0]?.company === 'Grab', 'variant with class: company matches');

const CARD_WITH_SPACE = CARD.replace('<li>', '<li >');
const variant2 = parseLinkedInCards(CARD_WITH_SPACE);
assert(variant2.length === 1, 'card with <li > (space before >) tag parses');
assert(variant2[0]?.title === 'Software Engineer', 'variant with space: title matches');

section('parseLinkedInCards — entity decoding');

const CARD_WITH_ENTITY = CARD.replace('Grab', 'Smith &amp; Co');
const entity = parseLinkedInCards(CARD_WITH_ENTITY);
assert(entity.length === 1, 'card with HTML entity parses');
assert(entity[0]?.company === 'Smith & Co', 'HTML entity &amp; decodes to &');

section('parseLinkedInCards — malformed vs empty');

const BROKEN_MARKUP = '<div class="base-search-card">Not a real card</div>';
const broken = parseLinkedInCards(BROKEN_MARKUP);
assert(broken.length === 0, 'HTML with base-search-card but no card structure returns empty array');

section('fetch — ctx is injected, so no network is touched');

// One fake ctx per test: `pages` is the response for each successive request.
function fakeCtx(pages) {
  const calls = [];
  return {
    calls,
    transport: 'test',
    fetchJson: async () => { throw new Error('linkedin-guest must not use fetchJson'); },
    fetchText: async (url, opts) => {
      calls.push({ url, opts });
      const body = pages[calls.length - 1];
      if (body === undefined) throw new Error('unexpected extra page fetch');
      return body;
    },
  };
}

const FULL_PAGE = CARD.repeat(10); // RESULTS_PER_PAGE — provider will ask for another
// LinkedIn's guest rate-limit response: a 302 to /authwall that itself returns
// HTTP 200. No card markers, so the marker-based guard cannot see it.
const AUTHWALL = '<html><body><h1>Join LinkedIn</h1><p>Sign in to continue</p></body></html>';

async function expectThrow(ctx, entry, name) {
  try {
    await linkedinGuest.fetch(entry, ctx);
    assert(false, name);
  } catch {
    assert(true, name);
  }
}

{
  const ctx = fakeCtx([FULL_PAGE, '']);
  const jobs = await linkedinGuest.fetch({ searchKeywords: 'software engineer' }, ctx);
  assert(jobs.length === 10, 'a full first page followed by an empty page returns the first page');
  assert(ctx.calls.length === 2, 'a genuinely empty later page ends the loop without throwing');
  assert(ctx.calls[0].opts?.redirect === 'error', 'fetchText is called with redirect: error (no silent authwall follow)');
}

await expectThrow(
  fakeCtx(['<ul><li class="base-search-card">Not a real card</li></ul>']),
  { searchKeywords: 'software engineer' },
  'page 1 with card markers but 0 parseable cards throws (markup changed)'
);

await expectThrow(
  fakeCtx([AUTHWALL]),
  { searchKeywords: 'software engineer' },
  'page 1 returning 0 cards and no markers throws — an authwall/rate-limit page is never a quiet market'
);

await expectThrow(
  fakeCtx(['']),
  { searchKeywords: 'software engineer' },
  'page 1 returning an empty body throws rather than yielding an empty source'
);

{
  const ctx = fakeCtx([FULL_PAGE, FULL_PAGE, FULL_PAGE, FULL_PAGE]);
  const jobs = await linkedinGuest.fetch({ maxPages: 2 }, ctx);
  assert(ctx.calls.length === 2, 'the maxPages cap is respected (2 pages requested, 2 fetched)');
  assert(jobs.length === 20, 'both capped pages are returned');
  assert(
    new URL(ctx.calls[1].url).searchParams.get('start') === '10',
    'pagination advances by RESULTS_PER_PAGE'
  );
}

{
  const ctx = fakeCtx([FULL_PAGE, AUTHWALL]);
  const jobs = await linkedinGuest.fetch({ maxPages: 3 }, ctx);
  assert(jobs.length === 10, 'a later page going bad keeps what was already collected');
}

section('Apply route');

assert(
  parseApplyType('data-tracking-control-name="public_jobs_apply-link-onsite"') === 'easy',
  'an onsite apply link is Easy Apply'
);
assert(
  parseApplyType('data-tracking-control-name="public_jobs_apply-link-offsite"') === 'external',
  'an offsite apply link is a company-site handoff'
);
assert(parseApplyType('<html>no apply control</html>') === 'unknown', 'neither marker is unknown');

{
  const pages = ['...apply-link-onsite...', '...apply-link-offsite...'];
  const ctx = { fetchText: async () => pages.shift() ?? Promise.reject(new Error('boom')) };
  const jobs = await annotateApplyType(
    [{ url: 'a' }, { url: 'b' }, { url: 'c' }], ctx
  );
  assert(
    jobs.map(j => j.applyType).join(',') === 'easy,external,unknown',
    'each job is tagged, and a failed lookup is kept as unknown rather than dropped'
  );
}

{
  let calls = 0;
  const ctx = { fetchText: async () => { calls++; return '...apply-link-onsite...'; } };
  const jobs = await annotateApplyType([{ url: 'a' }, { url: 'b' }, { url: 'c' }], ctx, 2);
  assert(calls === 2, 'the lookup cap is respected');
  assert(jobs.length === 3 && jobs[2].applyType === 'unknown', 'jobs past the cap survive as unknown');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
