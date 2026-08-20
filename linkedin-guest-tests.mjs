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

import { parseLinkedInCards } from './providers/linkedin-guest.mjs';

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

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
