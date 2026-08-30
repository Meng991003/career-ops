// foundit.sg (formerly Monster Singapore) — zero-token JSON search provider.
//
// Endpoint: GET /middleware/jobsearch?start=&limit=&query=&locations=
//
// Two things about this host that are easy to get wrong:
//
// 1. CONTENT NEGOTIATION. Without an explicit Accept header the endpoint
//    answers `{"error":400,"message":"content negotiation failed"}` — a JSON
//    body, HTTP 400, which reads like a bad query rather than a missing header.
//    `Accept: */*` works; `application/vnd.foundit.v1+json` returns HTTP 500.
//    The Referer and X-Requested-With headers are sent for the same reason.
//
// 2. The public SRP page is NOT scrapeable. It ships behind bot protection and
//    a plain fetch of /srp/results returns the shell with zero listings, so
//    HTML parsing (the linkedin-guest approach) is not an option here. This
//    JSON endpoint is the only viable path.
//
// SALARY: records carry BOTH `absoluteValue` (annual) and
// `absoluteMonthlyValue` (monthly), exactly 12x apart. career-ops stores
// salary ANNUALIZED, so `absoluteValue` is used directly. Verified against 13
// priced records: 54000/4500, 120000/10000, 36000/3000 and so on.

/** @typedef {import('./_types.js').Provider} Provider */

const SEARCH_URL = 'https://www.foundit.sg/middleware/jobsearch';
const SITE_ORIGIN = 'https://www.foundit.sg';
const ALLOWED_FOUNDIT_HOSTS = new Set(['www.foundit.sg', 'foundit.sg']);
const DEFAULT_PAGE_SIZE = 50;
const DEFAULT_MAX_PAGES = 2;

// The endpoint 400s without these. See note 1 above.
const REQUIRED_HEADERS = {
  accept: '*/*',
  referer: `${SITE_ORIGIN}/srp/results`,
  'x-requested-with': 'XMLHttpRequest',
};

/**
 * Annualized salary from a foundit record, or null when undisclosed.
 *
 * Returns null rather than a zero range when the employer hid the figure:
 * downstream, null means "show it, unpriced" while {min:0,max:0} would look
 * like a real salary below any floor and silently drop the job.
 *
 * @param {object} item
 * @returns {{min:number,max:number,currency:string}|null}
 */
export function parseFounditSalary(item) {
  if (!item || item.hideSalary || item.jobSalaryConfidential) return null;

  const min = Number(item.minimumSalary?.absoluteValue) || 0;
  const max = Number(item.maximumSalary?.absoluteValue) || 0;
  if (max <= 0) return null;

  const currency = (item.currencyCode || item.maximumSalary?.currency || '').trim();
  if (!currency) return null;

  // A single posted figure arrives as 0-N; treat it as a point value, matching
  // how jobstreet.mjs handles a lone number.
  return { min: min > 0 ? min : max, max, currency };
}

/**
 * Map one foundit search record to a career-ops job.
 * @param {object} item
 * @returns {{title:string,url:string,company:string,location:string,postedAt?:number,salary?:object}|null}
 */
export function parseFounditItem(item) {
  if (!item || typeof item !== 'object') return null;

  const title = (item.title || '').trim();
  if (!title) return null;

  const path = (item.jdUrl || item.seoJdUrl || '').trim();
  if (!path) return null;

  let url;
  try {
    const parsed = new URL(path, SITE_ORIGIN);
    if (parsed.protocol !== 'https:') return null;
    if (!ALLOWED_FOUNDIT_HOSTS.has(parsed.hostname)) return null;
    url = parsed.href;
  } catch {
    return null;
  }

  // hideCompanyName means a confidential listing; keep the job, drop the name.
  const company = item.hideCompanyName ? '' : (item.companyName || '').trim();
  const location = (item.locations || '').trim();

  const created = Number(item.createdAt);
  const postedAt = Number.isFinite(created) && created > 0 ? created : null;

  const salary = parseFounditSalary(item);

  return {
    title,
    url,
    company,
    location,
    ...(postedAt != null ? { postedAt } : {}),
    ...(salary ? { salary } : {}),
  };
}

function buildSearchUrl({ keywords, location, start, limit }) {
  const url = new URL(SEARCH_URL);
  if (keywords) url.searchParams.set('query', keywords);
  if (location) url.searchParams.set('locations', location);
  url.searchParams.set('start', String(start));
  url.searchParams.set('limit', String(limit));
  return url.href;
}

/** @type {Provider} */
export default {
  id: 'foundit',

  detect(_entry) {
    // Aggregator, not a company ATS: require an explicit `provider: foundit`
    // in portals.yml, matching the jobstreet and linkedin-guest precedent.
    return null;
  },

  async fetch(entry, ctx) {
    const keywords = entry.searchKeywords || '';
    const location = entry.searchLocation || 'Singapore';
    const pageSize = Number(entry.pageSize) || DEFAULT_PAGE_SIZE;
    const maxPages = Number(entry.maxPages) || DEFAULT_MAX_PAGES;

    const all = [];
    for (let page = 0; page < maxPages; page++) {
      const url = buildSearchUrl({ keywords, location, start: page * pageSize, limit: pageSize });

      let payload;
      try {
        payload = await ctx.fetchJson(url, { headers: REQUIRED_HEADERS });
      } catch (err) {
        // Page 1 failing is fatal for this entry; scan.mjs logs and moves on.
        // Later pages failing is non-fatal — keep what we already have.
        if (page === 0) throw err;
        console.error(`foundit: page ${page + 1} failed — ${err.message}`);
        break;
      }

      // The endpoint answers HTTP 200 with an embedded status, so a failure
      // here would otherwise parse as "zero jobs" and vanish from the digest
      // with nothing in `failures` — the linkedin-guest authwall bug.
      const status = payload?.jobSearchStatus;
      if (status !== undefined && Number(status) !== 200) {
        const text = payload?.jobSearchStatusText || 'unknown error';
        throw new Error(`foundit search returned status ${status}: ${text}`);
      }

      const data = payload?.jobSearchResponse?.data;
      if (!Array.isArray(data)) {
        throw new Error('foundit response has no jobSearchResponse.data array');
      }
      if (data.length === 0) break;

      const batch = data.map(parseFounditItem).filter(Boolean);
      if (page === 0 && batch.length === 0) {
        throw new Error(`foundit returned ${data.length} records but none parsed`);
      }

      all.push(...batch);
      if (data.length < pageSize) break;
    }

    return all;
  },
};
