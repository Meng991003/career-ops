// server/lib/detail.mjs
// Pure parsers behind the job detail drawer. Inputs are file contents; the
// route does the I/O. Row numbers stay strings — they are tracker # cells.
import { parseTable } from './markdown-table.mjs';

export function parseStatusLog(text) {
  const out = [];
  for (const line of String(text || '').split('\n')) {
    const c = line.split('\t');
    if (c.length < 5 || !/^\d+$/.test(c[0]) || !/^\d{4}-\d{2}-\d{2}$/.test(c[1])) continue;
    out.push({ num: c[0], date: c[1], from: c[2], to: c[3], source: c[4], note: (c[5] || '').trim() });
  }
  return out;
}

export function appliedOnByRow(entries) {
  const out = {};
  for (const e of entries) if (e.to === 'Applied') out[e.num] = e.date; // later lines win
  return out;
}

export function parseFollowUps(text, num) {
  const out = [];
  for (const r of parseTable(String(text || '')).rows) {
    if (String(r.appNum).trim() !== String(num)) continue;
    const who = r.contact ? ` to ${r.contact}` : '';
    out.push({ date: r.date, kind: 'sent', detail: `${r.channel || 'follow-up'}${who}${r.notes ? ` — ${r.notes}` : ''}` });
  }
  const due = new RegExp(`^- next #${num} (\\d{4}-\\d{2}-\\d{2})\\b`, 'm');
  const m = String(text || '').match(due);
  if (m) out.push({ date: m[1], kind: 'due', detail: 'follow-up due' });
  return out;
}

export function reportNumOf(row) {
  const m = String(row?.Report || '').match(/\[(\d+)\]/);
  return m ? Number(m[1]) : null;
}

export function outputDirFor(reportNum, dirNames) {
  return dirNames.find(d => {
    const m = d.match(/^(\d+)-/);
    return m && Number(m[1]) === reportNum;
  }) ?? null;
}
