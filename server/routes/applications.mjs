// server/routes/applications.mjs
import { readFile, readdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { parseTable, findRowByNum } from '../lib/markdown-table.mjs';
import { REPO_ROOT } from '../lib/paths.mjs';
import { readJsonBody, sendJson } from '../lib/http.mjs';
import { runScript } from '../lib/run.mjs';
import { resolveTrackerPath, getCareerOpsRoot } from '../../path-resolver.mjs';
import { parseStatusLog, appliedOnByRow, parseFollowUps, reportNumOf, outputDirFor } from '../lib/detail.mjs';
import { parseContacts } from '../../contacts.mjs';
import { findCaptureForReport } from '../../jd-capture.mjs';

// set-status.mjs exit codes → HTTP. It owns validation, the tracker lock, the
// atomic write and the status-log.tsv ledger; this route only translates.
const EXIT_HTTP = { 1: 400, 2: 404, 3: 409, 4: 503 };

async function loadTracker() {
  const abs = resolveTrackerPath(getCareerOpsRoot());
  if (!existsSync(abs)) return { headers: [], rows: [], abs, raw: '' };
  const raw = await readFile(abs, 'utf-8');
  return { ...parseTable(raw), abs, raw };
}

const readIf = async abs => (existsSync(abs) ? readFile(abs, 'utf-8') : '');
// status-log.tsv is the tracker's sibling (set-status.mjs writes it there).
const statusLogOf = trackerAbs => readIf(join(dirname(trackerAbs), 'status-log.tsv'));
const fileUrl = (root, rel) => `/api/files/${root}/${rel.split('/').map(encodeURIComponent).join('/')}`;

export async function list(req, res) {
  const { rows, abs } = await loadTracker();
  const groups = {};
  for (const r of rows) {
    const s = (r['Status'] || '').trim();
    (groups[s] ||= []).push(r);
  }
  const appliedOn = appliedOnByRow(parseStatusLog(await statusLogOf(abs)));
  sendJson(res, 200, { rows, groups, appliedOn });
}

export async function getOne(req, res, [num]) {
  const { rows, abs } = await loadTracker();
  const row = findRowByNum(rows, num);
  if (!row) return sendJson(res, 404, { error: 'not found' });

  let report = null;
  const link = (row['Report'] || '').match(/\(([^)]+\.md)\)/);
  if (link) {
    const rel = link[1].replace(/^\.\.\//, '');
    if (rel.startsWith('reports/')) report = (await readIf(join(REPO_ROOT, rel))) || null;
  }

  const statusTimeline = parseStatusLog(await statusLogOf(abs))
    .filter(e => e.num === String(num))
    .map(e => ({ date: e.date, kind: 'status', detail: `${e.from} → ${e.to}${e.note ? ` (${e.note})` : ''}` }));
  const followUps = parseFollowUps(await readIf(join(REPO_ROOT, 'data/follow-ups.md')), String(num));
  const timeline = [...statusTimeline, ...followUps].sort((a, b) => a.date.localeCompare(b.date));

  const reportNum = reportNumOf(row);
  const documents = { cv: null, cover: null };
  if (reportNum) {
    const outRoot = join(REPO_ROOT, 'output');
    const dirs = existsSync(outRoot) ? await readdir(outRoot) : [];
    const dir = outputDirFor(reportNum, dirs);
    if (dir) {
      for (const k of ['cv', 'cover']) {
        if (existsSync(join(outRoot, dir, `${k}.pdf`))) documents[k] = fileUrl('output', `${dir}/${k}.pdf`);
      }
    }
  }

  const contacts = parseContacts(await readIf(join(REPO_ROOT, 'data/contacts.tsv')))
    .contacts.filter(c => c.tracker === String(num));

  const cap = reportNum ? findCaptureForReport(join(REPO_ROOT, 'jds'), reportNum) : null;
  const jd = cap ? { filename: cap.filename, url: fileUrl('jds', cap.filename) } : null;

  sendJson(res, 200, { row, report, timeline, documents, contacts, jd });
}

export async function patch(req, res, [num]) {
  if (!/^\d+$/.test(num)) return sendJson(res, 400, { error: 'row number must be a positive integer' });
  const body = await readJsonBody(req);
  const note = typeof body.note === 'string' ? body.note.trim() : '';
  let status = typeof body.status === 'string' ? body.status.trim() : '';
  if (!status && !note) return sendJson(res, 400, { error: 'status or note required' });
  if (!status) {
    // set-status needs a state with --row; restating the current one is a
    // no-op for status and logs no transition.
    // ponytail: read-then-resend race — a status change landing between this
    // read and set-status's write is reverted by our resend. Upgrade path:
    // a note-only mode in set-status that skips the status arg entirely.
    const row = findRowByNum((await loadTracker()).rows, num);
    if (!row) return sendJson(res, 404, { error: `no tracker row #${num}` });
    status = row['Status'];
  }
  const args = ['--row', num, status, '--source', 'web', '--json'];
  if (note) args.push('--note', note);
  const { code, stdout, stderr } = await runScript('set-status.mjs', args);
  let out;
  try { out = JSON.parse(stdout); } catch { out = { error: (stderr || stdout).trim() || 'set-status failed' }; }
  sendJson(res, code === 0 ? 200 : (EXIT_HTTP[code] ?? 500), out);
}
