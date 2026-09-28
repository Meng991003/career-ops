// server/routes/files.mjs
// Serves generated PDFs (output/) and JD captures (jds/) to the drawer's
// preview iframes. Read-only; the resolved path must stay inside its root.
import { join, relative, isAbsolute, extname } from 'path';
import { REPO_ROOT } from '../lib/paths.mjs';
import { serveStatic, sendJson } from '../lib/http.mjs';

// output/ holds generated HTML previews and jds/ holds untrusted third-party
// captures; only these document types may be served, so HTML/SVG never runs
// same-origin through this route.
const ALLOWED_EXT = new Set(['.pdf', '.md', '.txt']);
const HEADERS = { 'x-content-type-options': 'nosniff', 'content-security-policy': 'sandbox' };

export async function get(req, res, [root, rest]) {
  const base = join(REPO_ROOT, root);
  let abs;
  try { abs = join(base, decodeURIComponent(rest)); } catch { return sendJson(res, 400, { error: 'bad path' }); }
  const rel = relative(base, abs);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return sendJson(res, 404, { error: 'not found' });
  if (!ALLOWED_EXT.has(extname(abs).toLowerCase())) return sendJson(res, 404, { error: 'not found' });
  if (!(await serveStatic(res, abs, HEADERS))) sendJson(res, 404, { error: 'not found' });
}
