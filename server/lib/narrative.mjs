// Pure text<->structure helpers for the narrative form fields.
// Superpowers are one-per-line; proof points are "name | metric | url" per line.
// The server owns all parsing/formatting so the frontend stays dumb (drops
// strings into textareas and sends them back).

export function parseList(text) {
  return String(text ?? '').split('\n').map(s => s.trim()).filter(Boolean);
}

export function formatList(arr) {
  return Array.isArray(arr) ? arr.join('\n') : '';
}

export function parseProofPoints(text) {
  return String(text ?? '').split('\n').map(line => {
    const parts = line.split('|').map(s => s.trim());
    return { name: parts[0] || '', hero_metric: parts[1] || '', url: parts[2] || '' };
  }).filter(p => p.name);
}

export function formatProofPoints(arr) {
  if (!Array.isArray(arr)) return '';
  return arr.map(p => {
    const seg = [p?.name || '', p?.hero_metric || '', p?.url || ''];
    while (seg.length && seg[seg.length - 1] === '') seg.pop();
    return seg.join(' | ');
  }).join('\n');
}
