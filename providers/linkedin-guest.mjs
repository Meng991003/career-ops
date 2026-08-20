// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// LinkedIn guest-endpoint provider — reads the PUBLIC, UNAUTHENTICATED job
// search fragment that backs linkedin.com's logged-out job search.
//
//   GET /jobs-guest/jobs/api/seeMoreJobPostings/search
//         ?keywords=<terms>&location=<place>&start=<offset>
//
// Returns an HTML fragment of <li> cards (NOT JSON), 10 per request.
//
// This provider never authenticates, so it carries no risk to the candidate's
// LinkedIn account. It is nonetheless BEST-EFFORT: the endpoint is undocumented
// and may rate-limit by IP or change shape without notice. scan.mjs treats a
// throwing provider as a non-fatal skip, which is the intended behaviour here.
//
// Requests are sequential with a delay between pages, and page count is capped.
// Uses career-ops' own User-Agent from _http.mjs — no browser spoofing.
//
// Portal entry fields (all optional except `provider`):
//   searchKeywords — search terms (default: '')
//   searchLocation — location filter (default: 'Singapore')
//   pageSize       — informational; the endpoint fixes this at 10
//   maxPages       — pages to fetch (default: 3)

const SEARCH_URL = 'https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search';
const RESULTS_PER_PAGE = 10;
const DEFAULT_MAX_PAGES = 3;
const PAGE_DELAY_MS = 400;

const ALLOWED_LINKEDIN_HOST = /(^|\.)linkedin\.com$/;

/** Decode the handful of HTML entities that appear in these cards. */
function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

/** Collapse whitespace and trim — card text is heavily indented. */
function clean(s) {
  return decodeEntities(String(s || '')).replace(/\s+/g, ' ').trim();
}

/** First capture group of `re` against `s`, cleaned; '' when no match. */
function pick(s, re) {
  const m = s.match(re);
  return m ? clean(m[1]) : '';
}

// NaN-safe Date.parse, mirroring providers/jobstreet.mjs.
function toEpochMs(value) {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/**
 * Parse the guest-endpoint HTML fragment into canonical Job objects.
 * Exported for unit testing.
 *
 * A malformed card is skipped rather than aborting the batch — a single
 * layout change on one row must not cost the whole page.
 *
 * @param {string} html
 * @returns {Array<{title: string, url: string, company: string, location: string, postedAt?: number}>}
 */
export function parseLinkedInCards(html) {
  if (typeof html !== 'string' || !html) return [];

  const jobs = [];
  // Split on <li followed by > or whitespace to tolerate attributes like <li class="...">.
  for (const chunk of html.split(/<li[\s>]/).slice(1)) {
    try {
      const title = pick(chunk, /base-search-card__title"[^>]*>([\s\S]*?)</);
      if (!title) continue;

      const rawHref = pick(chunk, /href="(https:\/\/[^"]*\/jobs\/view\/[^"]+)"/);
      if (!rawHref) continue;

      let url;
      try {
        const parsed = new URL(rawHref);
        if (parsed.protocol !== 'https:') continue;
        if (!ALLOWED_LINKEDIN_HOST.test(parsed.hostname)) continue;
        // Strip tracking query params — the bare path is the stable dedup key.
        url = `${parsed.origin}${parsed.pathname}`;
      } catch {
        continue;
      }

      const company = pick(chunk, /hidden-nested-link"[^>]*>([\s\S]*?)</);
      const location = pick(chunk, /job-search-card__location"[^>]*>([\s\S]*?)</);
      const postedAt = toEpochMs(pick(chunk, /datetime="([^"]+)"/));

      jobs.push({ title, url, company, location, ...(postedAt != null ? { postedAt } : {}) });
    } catch {
      // Skip this card, keep the rest.
      continue;
    }
  }
  return jobs;
}

/** @type {Provider} */
export default {
  id: 'linkedin-guest',

  detect(_entry) {
    // LinkedIn is an aggregator, not a company ATS. Require an explicit
    // `provider: linkedin-guest` in portals.yml, matching the jobstreet
    // precedent.
    return null;
  },

  async fetch(entry, ctx) {
    const keywords = entry.searchKeywords || '';
    const location = entry.searchLocation || 'Singapore';
    const maxPages = Number(entry.maxPages) || DEFAULT_MAX_PAGES;

    const all = [];
    for (let page = 0; page < maxPages; page++) {
      const url = new URL(SEARCH_URL);
      if (keywords) url.searchParams.set('keywords', keywords);
      if (location) url.searchParams.set('location', location);
      url.searchParams.set('start', String(page * RESULTS_PER_PAGE));

      let html;
      try {
        // `redirect: 'error'` matches providers/jobstreet.mjs. Without it,
        // LinkedIn's typical guest rate-limit response — a 302 to /authwall,
        // which itself returns HTTP 200 — is followed silently. That page has
        // no card markers, so the guard below did not trip either: the whole
        // source vanished from the digest with no entry in `failures`.
        html = await ctx.fetchText(url.href, { redirect: 'error' });
      } catch (err) {
        // Page 1 failing is fatal for this entry; scan.mjs logs and moves on.
        // Later pages failing is non-fatal — keep what we have.
        if (page === 0) throw err;
        console.error(`linkedin-guest: page ${page + 1} failed — ${err.message}`);
        break;
      }

      const batch = parseLinkedInCards(html);
      if (batch.length === 0) {
        // Distinguish "no results" from "parser broke".
        // If HTML contains card markers but we parsed 0 cards, the endpoint markup likely changed.
        if (html.includes('base-search-card')) {
          throw new Error('linkedin-guest: fetched HTML contains card markers but 0 cards parsed — the guest endpoint markup likely changed');
        }
        // The FIRST page returning nothing is a failure, not an empty market:
        // a Singapore "software engineer" search never legitimately returns
        // zero results, so this is an authwall body, a rate limit, or a shape
        // change. Throwing puts the source in the digest's `failures` list
        // instead of silently dropping ~80 candidates. A later page returning
        // zero is the normal end of results and still just breaks.
        if (page === 0) {
          throw new Error('linkedin-guest: first page returned 0 job cards and no card markers — likely an authwall page or rate limit, not an empty result set');
        }
        break;
      }
      all.push(...batch);

      if (batch.length < RESULTS_PER_PAGE) break;
      await new Promise(resolve => setTimeout(resolve, PAGE_DELAY_MS));
    }

    return all;
  },
};
