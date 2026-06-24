// server/lib/markdown-table.mjs
// Parse/serialize the applications.md GFM table. Keyed by header NAME so
// inserting a column never shifts Score/Status (see repo #946).

function splitRow(line) {
  // Trim the outer pipes, then split. Keeps interior empty cells.
  const t = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return t.split('|').map(c => c.trim());
}

const isSeparator = cells => cells.length > 0 && cells.every(c => /^:?-{3,}:?$/.test(c));

export function parseTable(markdown) {
  const lines = markdown.split('\n');
  const tableLines = lines.filter(l => l.trim().startsWith('|') && l.includes('|'));
  if (tableLines.length === 0) return { headers: [], rows: [] };

  const headers = splitRow(tableLines[0]);
  const rows = [];
  for (const line of tableLines.slice(1)) {
    const cells = splitRow(line);
    if (isSeparator(cells)) continue;
    const row = {};
    headers.forEach((h, i) => { row[h] = cells[i] ?? ''; });
    rows.push(row);
  }
  return { headers, rows };
}

export function serializeRows(headers, rows) {
  const head = `| ${headers.join(' | ')} |`;
  const sep = `|${headers.map(() => '---').join('|')}|`;
  const body = rows.map(r => `| ${headers.map(h => (r[h] ?? '')).join(' | ')} |`);
  return [head, sep, ...body].join('\n') + '\n';
}

export function findRowByNum(rows, num) {
  const key = String(num).trim();
  return rows.find(r => String(r['#']).trim() === key);
}
