// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Jobstreet / SEEK provider — hits the public jobsearch JSON API (v5).
// Jobstreet (jobstreet.com, jobstreet.co.id, jobstreet.sg, etc.) and SEEK
// (seek.com.au, seek.co.nz) share the same SEEK infrastructure and expose a
// public, no-auth JSON search endpoint at /api/jobsearch/v5/search.
//
// v5 API shape differs from the retired v4: there is no jobUrl field (the
// detail URL is built from id as {base}/job/{id}), company lives in
// advertiser.description (branding carries only logo), and location became
// an array keyed on locations[0].label.
//
// This provider is designed for explicit `provider: jobstreet` in
// portals.yml. Auto-detection from careers_url is not supported because
// Jobstreet is a job board aggregator, not a company ATS — setting
// `provider: jobstreet` on a tracked_companies entry is the intended usage.
//
// Portal entry fields (all optional except `provider`):
//   api             — Base search URL (default: https://sg.jobstreet.com/api/jobsearch/v5/search)
//   siteKey         — SEEK site key (default: "SG-Main" for Singapore)
//   searchKeywords  — Search keywords, space-separated (default: reads from title_filter via keywords parameter)
//   searchLocation  — Location filter string (default: none)
//   pageSize        — Results per page (default: 30, max observed: 100)
//   maxPages        — Maximum pages to fetch (default: 3, set to 1 for speed)

const DEFAULT_API = 'https://sg.jobstreet.com/api/jobsearch/v5/search';
const DEFAULT_SITE_KEY = 'SG-Main';
const DEFAULT_PAGE_SIZE = 30;
const DEFAULT_MAX_PAGES = 3;

const ALLOWED_JOBSTREET_HOSTS = new Set([
  'id.jobstreet.com',
  'www.jobstreet.com',
  'www.jobstreet.co.id',
  'jobstreet.com',
  'jobstreet.co.id',
  'sg.jobstreet.com',
  'my.jobstreet.com',
  'www.seek.com.au',
  'www.seek.co.nz',
]);

/** @param {string} url */
function assertJobstreetUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`jobstreet: invalid URL: ${url}`);
  }
  if (parsed.protocol !== 'https:') throw new Error(`jobstreet: URL must use HTTPS: ${url}`);
  if (!ALLOWED_JOBSTREET_HOSTS.has(parsed.hostname))
    throw new Error(`jobstreet: untrusted hostname "${parsed.hostname}" — must be one of: ${[...ALLOWED_JOBSTREET_HOSTS].join(', ')}`);
  return url;
}

/**
 * Derive the job detail base URL from the API hostname.
 * e.g. id.jobstreet.com → https://id.jobstreet.com
 * @param {string} apiUrl
 * @returns {string}
 */
function deriveBaseUrl(apiUrl) {
  try {
    const parsed = new URL(apiUrl);
    return `${parsed.protocol}//${parsed.hostname}`;
  } catch {
    return 'https://id.jobstreet.com';
  }
}

// NaN-safe Date.parse
function toEpochMs(value) {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

// Minimum plausible monthly figure. Guards against parsing hourly rates or
// stray numbers ("$200 per month") into a salary that would wrongly reject a
// job. Anything below this yields null, so the job passes the filter instead.
const MIN_PLAUSIBLE_MONTHLY = 1000;

/**
 * Parse a JobStreet `salaryLabel` free-text string into an ANNUALIZED
 * `{min, max, currency}`, matching the convention of `parseCompensation` in
 * providers/ashby.mjs and the shape `buildSalaryFilter` in scan.mjs consumes.
 *
 * Deliberately conservative: this handles only the unambiguous canonical form
 * and returns null for everything else. `buildSalaryFilter` passes jobs with no
 * salary data, so null means "show it, unpriced" — strictly safer than guessing
 * a number that could wrongly reject a viable role. Real labels that must yield
 * null include "World Class Benefits" and "$4k - $4500 p.m. + Aws,Bonus".
 *
 * @param {string|null|undefined} label
 * @returns {{min: number, max: number, currency: string}|null}
 */
export function parseSalaryLabel(label) {
  if (typeof label !== 'string') return null;
  const text = label.trim();
  if (!text) return null;

  // Require an explicit currency marker.
  if (!/\$|\bSGD\b/i.test(text)) return null;

  // Require an explicit, unambiguous period. Abbreviations like "p.m." appear
  // only in noisy free-text labels, so they are intentionally not accepted.
  const multiplier = /per\s+month|monthly/i.test(text) ? 12
    : /per\s+year|per\s+annum|annually|yearly/i.test(text) ? 1
    : null;
  if (multiplier === null) return null;

  // Reject shorthand magnitudes ("$4k") — ambiguous enough that guessing risks
  // an order-of-magnitude error.
  if (/\d\s*k\b/i.test(text)) return null;

  // Find all money expressions in the label. A money expression is either:
  //   RANGE:  <marker> NUM <sep> [<marker>] NUM
  //   SINGLE: <marker> NUM
  // where <marker> is $, S$, or SGD; NUM is digits with optional commas/decimals;
  // and <sep> is -, –, —, or "to".
  // Require EXACTLY ONE money expression (salary is either a single value or a range,
  // never "salary + allowance").
  const moneyPattern = /(?:\$|S\$|SGD)\s*(\d[\d,]*(?:\.\d+)?)(?:\s*(?:[-–—]|\bto\b)\s*(?:\$|S\$|SGD)?\s*(\d[\d,]*(?:\.\d+)?))?/gi;
  const moneyMatches = [...text.matchAll(moneyPattern)];

  if (moneyMatches.length !== 1) return null;

  const match = moneyMatches[0];
  // match[1] is always the first number
  // match[2] is the second number (only in ranges)
  const firstNum = Number(match[1].replace(/,/g, ''));
  const secondNum = match[2] ? Number(match[2].replace(/,/g, '')) : firstNum;

  if (!Number.isFinite(firstNum) || !Number.isFinite(secondNum)) return null;

  const numbers = match[2] ? [firstNum, secondNum] : [firstNum];

  const monthlyEquivalents = numbers.filter(
    n => (multiplier === 12 ? n : n / 12) >= MIN_PLAUSIBLE_MONTHLY
  );
  if (monthlyEquivalents.length === 0) return null;

  const annualized = monthlyEquivalents.map(n => n * multiplier);
  return {
    min: Math.min(...annualized),
    max: Math.max(...annualized),
    // Currency is hardcoded to SGD: the project is scoped to Singapore only,
    // and the sole call site is sg.jobstreet.com where a bare "$" unambiguously
    // means SGD. This is a deliberate simplification, not an oversight.
    currency: 'SGD',
  };
}

/**
 * Parse a single JobStreet/SEEK **v5** API result into the canonical Job shape.
 *
 * v5 differs from the retired v4 in three ways that matter here:
 *   - there is no `jobUrl` field — the detail URL is `{base}/job/{id}`
 *   - company lives in `advertiser.description` (`branding` carries only a logo)
 *   - `location` became `locations[]`, keyed on `.label`
 *
 * @param {any} item — raw v5 result item
 * @param {string} baseUrl — scheme + hostname used to build the job URL
 * @param {string} fallbackCompany — company name fallback from the portal entry
 * @returns {{title: string, url: string, company: string, location: string, postedAt?: number}|null}
 */
export function parseJobstreetItem(item, baseUrl, fallbackCompany) {
  if (!item || typeof item !== 'object') return null;

  const title = (item.title || '').trim();
  if (!title) return null;

  const id = String(item.id ?? '').trim();
  if (!id) return null;

  // v5 has no jobUrl — build it, then validate the host we built it on.
  let url;
  try {
    const parsed = new URL(`/job/${encodeURIComponent(id)}`, baseUrl);
    if (parsed.protocol !== 'https:') return null;
    if (!ALLOWED_JOBSTREET_HOSTS.has(parsed.hostname)) return null;
    url = parsed.href;
  } catch {
    return null;
  }

  const company = (
    item.advertiser?.description
    || item.companyName
    || item.branding?.name
    || fallbackCompany
    || ''
  ).trim();

  const location = (item.locations?.[0]?.label || '').trim();
  const postedAt = toEpochMs(item.listingDate);

  return { title, url, company, location, ...(postedAt != null ? { postedAt } : {}) };
}

/**
 * Build the search URL with query parameters.
 * @param {string} apiUrl
 * @param {object} params
 * @returns {string}
 */
function buildSearchUrl(apiUrl, params) {
  const url = new URL(apiUrl);
  const { siteKey, keywords, location, pageSize, page } = params;
  if (siteKey) url.searchParams.set('siteKey', siteKey);
  if (keywords) url.searchParams.set('keywords', keywords);
  if (location) url.searchParams.set('where', location);
  url.searchParams.set('pageSize', String(pageSize || DEFAULT_PAGE_SIZE));
  url.searchParams.set('page', String(page || 1));
  return url.href;
}

/** @type {Provider} */
export default {
  id: 'jobstreet',

  detect(_entry) {
    // Jobstreet is a job board aggregator, not a company ATS.
    // Auto-detection from careers_url is intentionally not supported —
    // use `provider: jobstreet` explicitly in portals.yml.
    return null;
  },

  async fetch(entry, ctx) {
    const apiUrl = entry.api || DEFAULT_API;
    assertJobstreetUrl(apiUrl);
    const baseUrl = deriveBaseUrl(apiUrl);

    const siteKey = entry.siteKey || DEFAULT_SITE_KEY;
    const keywords = entry.searchKeywords || '';
    const searchLocation = entry.searchLocation || '';
    const pageSize = Number(entry.pageSize) || DEFAULT_PAGE_SIZE;
    const maxPages = Number(entry.maxPages) || DEFAULT_MAX_PAGES;
    const fallbackCompany = entry.name || '';

    const allJobs = [];

    for (let page = 1; page <= maxPages; page++) {
      const searchUrl = buildSearchUrl(apiUrl, {
        siteKey,
        keywords,
        location: searchLocation,
        pageSize,
        page,
      });

      let json;
      try {
        json = /** @type {any} */ (await ctx.fetchJson(searchUrl, { redirect: 'error' }));
      } catch (err) {
        // If page 1 fails, surface the error. Later pages failing is non-fatal
        // — we return whatever we've collected so far.
        if (page === 1) throw err;
        console.error(`jobstreet: page ${page} fetch failed — ${err.message}`);
        break;
      }

      const data = Array.isArray(json?.data) ? json.data : [];
      if (data.length === 0) break;

      for (const item of data) {
        const job = parseJobstreetItem(item, baseUrl, fallbackCompany);
        if (!job) continue;
        const salary = parseSalaryLabel(item.salaryLabel);
        allJobs.push(salary ? { ...job, salary } : job);
      }

      // Stop if we got fewer results than pageSize (last page)
      if (data.length < pageSize) break;

      // Respect rate limits — small delay between pages
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    return allJobs;
  },
};
