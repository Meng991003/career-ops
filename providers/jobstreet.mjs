// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

import { sleep } from './_http.mjs';

// Jobstreet / SEEK provider — hits the public SEEK v5 JobSearch REST API.
//
// Jobstreet (jobstreet.com, jobstreet.co.id, etc.) and SEEK (seek.com.au,
// seek.co.nz) share the same SEEK infrastructure. The old chalice-search
// v4 API (/api/chalice-search/v4/search) was deprecated; the v5 API at
// /api/jobsearch/v5/search is the current replacement.
//
// This provider is designed for explicit `provider: jobstreet` in portals.yml.
// Auto-detection from careers_url is not supported because Jobstreet is a
// job board aggregator, not a company ATS.
//
// Portal entry fields (all optional except `provider`):
//   api             — v5 search endpoint URL (default: https://id.jobstreet.com/api/jobsearch/v5/search)
//   siteKey         — SEEK site key for regional filtering (default: "ID-Main")
//   searchKeywords  — Search keywords, space-separated (default: "")
//   searchLocation  — Location filter (default: "")
//   pageSize        — Results per page (default: 30)
//   maxPages        — Maximum pages to fetch (default: 3)
//   appendWorkType  — Append the listing's work type(s) to the title, e.g.
//                     "Strategy Consultant [Part time]", so title filters and
//                     triage can see employment type at scan time (default: false)
//
// Site keys by market:
//   ID-Main  → id.jobstreet.com (Indonesia)
//   SG-Main  → sg.jobstreet.com (Singapore)
//   MY-Main  → my.jobstreet.com (Malaysia)
//   AU-Main  → www.seek.com.au  (Australia — set api: https://www.seek.com.au/api/jobsearch/v5/search)
//   NZ-Main  → www.seek.co.nz   (New Zealand)
//   HK-Main  → hk.jobsdb.com    (Hong Kong)
//
// Hong Kong runs under the JobsDB brand rather than Jobstreet, but it is the
// same SEEK platform behind the same v5 endpoint, so it needs no separate
// provider — only its hostname in the allowlist below and siteKey: HK-Main.

const DEFAULT_API = 'https://id.jobstreet.com/api/jobsearch/v5/search';
const DEFAULT_SITE_KEY = 'ID-Main';
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
  // SEEK's Hong Kong property keeps the JobsDB brand; same v5 search API.
  'hk.jobsdb.com',
  'www.seek.com.au',
  'www.seek.co.nz',
]);

// v5 API paths (the client-side JS on jobstreet uses these relative paths
// resolved against the current origin). We keep the allowlist for SSRF
// protection on the base URL, then build the v5 search path from it.
const V5_SEARCH_PATH = '/api/jobsearch/v5/search';

// Job-detail path by market. Only the Indonesian sites carry the `/id/` locale
// prefix (https://id.jobstreet.com/id/job/<id>). Every other SEEK-platform host
// — my/sg.jobstreet.com, www.seek.com.au, www.seek.co.nz — serves /job/<id> and
// answers 404 on /id/job/<id> (verified against live ids, 2026-08-28). A global
// switch either way breaks one market, which is why this is keyed on the host.
const ID_LOCALE_HOSTS = new Set(['id.jobstreet.com', 'www.jobstreet.co.id', 'jobstreet.co.id']);

/** @param {string} origin — scheme + hostname */
function jobDetailPath(origin) {
  let host = '';
  try { host = new URL(origin).hostname; } catch { /* fall through to the common path */ }
  return ID_LOCALE_HOSTS.has(host) ? '/id/job/' : '/job/';
}

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
 * Derive the origin from the API hostname.
 * e.g. id.jobstreet.com → https://id.jobstreet.com
 * @param {string} apiUrl
 * @returns {string}
 */
function deriveOrigin(apiUrl) {
  try {
    const parsed = new URL(apiUrl);
    return `${parsed.protocol}//${parsed.hostname}`;
  } catch {
    return 'https://id.jobstreet.com';
  }
}

// Currency by market host. Hosts whose market is ambiguous (bare
// jobstreet.com / www.jobstreet.com serve more than one) are deliberately
// absent: a wrong currency is worse than no salary, and no salary is exactly
// what these postings carried before this parser existed.
const HOST_CURRENCY = {
  'sg.jobstreet.com': 'SGD',
  'my.jobstreet.com': 'MYR',
  'id.jobstreet.com': 'IDR',
  'www.jobstreet.co.id': 'IDR',
  'jobstreet.co.id': 'IDR',
  'hk.jobsdb.com': 'HKD',
  'www.seek.com.au': 'AUD',
  'www.seek.co.nz': 'NZD',
};

// `salaryLabel` is a display string, not structured data: "$3,500 – $4,000 per
// month", "$6,000 per month", "$35 – $45 per hour", or "" when the advertiser
// hid it. career-ops stores salary ANNUALIZED (see providers/foundit.mjs), so
// the period suffix picks the multiplier. Year is tested first so "per annum"
// can never fall through to a monthly reading.
const PERIOD_MULTIPLIER = [
  [/per\s+ann?um|per\s+year|annually|\/\s*(?:yr|year)\b/i, 1],
  [/per\s+month|monthly|\/\s*(?:mo|month)\b/i, 12],
  [/per\s+week|weekly/i, 52],
  [/per\s+day|daily/i, 260],
  [/per\s+hour|hourly|\/\s*(?:hr|hour)\b/i, 2080],
];

/**
 * Annualized salary from a v5 `salaryLabel`, or null when the advertiser hid
 * it, the period is unrecognized, or the host's currency is ambiguous.
 *
 * Returns null rather than a zero range: downstream, null means "show it,
 * unpriced", while {min:0,max:0} would look like a real salary below any floor
 * and silently drop the job (same rationale as parseFounditSalary).
 *
 * @param {string|undefined} label — item.salaryLabel
 * @param {string} origin — scheme + hostname, used to pick the currency
 * @returns {{min:number,max:number,currency:string}|null}
 */
export function parseJobstreetSalary(label, origin) {
  const text = (label || '').trim();
  if (!text) return null;

  let currency;
  try {
    currency = HOST_CURRENCY[new URL(origin).hostname];
  } catch {
    return null;
  }
  if (!currency) return null;

  const entry = PERIOD_MULTIPLIER.find(([re]) => re.test(text));
  if (!entry) return null;
  const multiplier = entry[1];

  const figures = (text.match(/\d[\d,]*(?:\.\d+)?/g) || [])
    .map((n) => Number(n.replace(/,/g, '')))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (figures.length === 0) return null;

  const max = Math.round(Math.max(...figures) * multiplier);
  if (max <= 0) return null;
  // A lone posted figure is a point value, matching parseFounditSalary.
  return { min: Math.round(Math.min(...figures) * multiplier), max, currency };
}

// NaN-safe Date.parse
function toEpochMs(value) {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/**
 * Parse a single Jobstreet/SEEK v5 search API result into the canonical Job shape.
 *
 * The v5 search API returns objects shaped like:
 *   {
 *     id: "92996157",
 *     title: "Facility Engineer",
 *     advertiser: { id: "60960115", description: "PT YOFC International Indonesia" },
 *     companyName: "YOFC International",
 *     locations: [{ label: "Karawang, West Java", countryCode: "ID", ... }],
 *     listingDate: "2026-06-29T02:53:00Z",
 *     listingDateDisplay: "16h ago",
 *     roleId: "facilities-engineer",
 *     salaryLabel: "",
 *     teaser: "...",
 *     workTypes: ["Full time"],
 *     workArrangements: { data: [{ id: "1", label: { text: "On-site" } }] },
 *     ...
 *   }
 *
 * This parser is exported as a named export for unit tests.
 *
 * @param {any} item — raw v5 API result item
 * @param {string} origin — scheme + hostname for building job detail URLs
 * @param {string} fallbackCompany — company name fallback from the portal entry
 * @param {{appendWorkType?: boolean}} [options] — appendWorkType: suffix the
 *   title with the listing's `workTypes` (e.g. "[Part time]"); off by default
 * @returns {{title: string, url: string, company: string, location: string, postedAt: number|undefined}|null}
 */
export function parseJobstreetItem(item, origin, fallbackCompany, options = {}) {
  if (!item || typeof item !== 'object') return null;

  let title = (item.title || '').trim();
  if (!title) return null;

  if (options.appendWorkType) {
    const types = Array.isArray(item.workTypes)
      ? item.workTypes.map(t => String(t ?? '').trim()).filter(Boolean)
      : [];
    if (types.length) title = `${title} [${types.join(', ')}]`;
  }

  // Build job URL from the job ID — path prefix depends on the market host
  const jobId = (item.id || '').trim();
  if (!jobId) return null;
  const url = `${origin}${jobDetailPath(origin)}${jobId}`;

  // Validate URL hostname belongs to allowed set
  try {
    const parsed = new URL(url);
    if (!ALLOWED_JOBSTREET_HOSTS.has(parsed.hostname)) return null;
  } catch {
    return null;
  }

  // Prefer advertiser.description for the branded company name, fall back
  // to companyName (which can be shorter/less specific), then entry name.
  const company = (item.advertiser?.description || item.companyName || fallbackCompany || '').trim();
  const location = (item.locations?.[0]?.label || '').trim();
  const postedAt = toEpochMs(item.listingDate);
  const salary = parseJobstreetSalary(item.salaryLabel, origin);

  return {
    title,
    url,
    company,
    location,
    ...(postedAt != null ? { postedAt } : {}),
    ...(salary ? { salary } : {}),
  };
}

/**
 * Build the v5 search URL with query parameters.
 * @param {string} origin — scheme + hostname
 * @param {object} params
 * @returns {string}
 */
function buildSearchUrl(origin, params) {
  const url = new URL(V5_SEARCH_PATH, origin);
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
    const origin = deriveOrigin(apiUrl);

    const siteKey = entry.siteKey || DEFAULT_SITE_KEY;
    const keywords = entry.searchKeywords || '';
    const searchLocation = entry.searchLocation || '';
    const pageSize = Number(entry.pageSize) || DEFAULT_PAGE_SIZE;
    const maxPages = Number(entry.maxPages) || DEFAULT_MAX_PAGES;
    const fallbackCompany = entry.name || '';
    const appendWorkType = entry.appendWorkType === true;

    const allJobs = [];

    for (let page = 1; page <= maxPages; page++) {
      const searchUrl = buildSearchUrl(origin, {
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
        const job = parseJobstreetItem(item, origin, fallbackCompany, { appendWorkType });
        if (job) allJobs.push(job);
      }

      // Stop if we got fewer results than pageSize (last page)
      if (data.length < pageSize) break;

      // Respect rate limits — small delay between pages
      await sleep(200, ctx);
    }

    return allJobs;
  },
};
