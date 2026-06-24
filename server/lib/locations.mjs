// Parse a free-text preferred-location string (e.g. "Kuala Lumpur / Remote")
// into a clean list of location keywords for portals.yml's location_filter.allow.
// Splits on commas and slashes, trims, drops empties, preserves first-seen order.
export function parsePreferredLocations(str) {
  const seen = new Set();
  const out = [];
  for (const part of String(str ?? '').split(/[,/]/)) {
    const v = part.trim();
    if (v && !seen.has(v)) { seen.add(v); out.push(v); }
  }
  return out;
}
