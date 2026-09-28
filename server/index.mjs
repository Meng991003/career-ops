// server/index.mjs
import http from 'http';
import { fileURLToPath } from 'url';
import { dirname, join, normalize } from 'path';
import { existsSync } from 'fs';
import { serveStatic, sendJson } from './lib/http.mjs';
import { REPO_ROOT } from './lib/paths.mjs';
import { isAllowedRequest } from './lib/guard.mjs';
import * as setup from './routes/setup.mjs';
import * as applications from './routes/applications.mjs';
import * as files from './routes/files.mjs';

// ui/dist (React, built) supersedes the legacy vanilla web/ once it exists.
// The old Setup screen stays reachable at /legacy until M4 replaces it.
const UI_DIST = join(REPO_ROOT, 'ui', 'dist');
const LEGACY_DIR = join(REPO_ROOT, 'web');
const WEB_DIR = existsSync(join(UI_DIST, 'index.html')) ? UI_DIST : LEGACY_DIR;

// [method, pattern(RegExp), handler(req,res,params)]
const ROUTES = [
  ['GET',   /^\/api\/setup\/status$/,        setup.getStatus],
  ['GET',   /^\/api\/setup\/data$/,          setup.getData],
  ['POST',  /^\/api\/setup\/cv$/,            setup.postCv],
  ['POST',  /^\/api\/setup\/cv\/upload$/,    setup.postCvUpload],
  ['POST',  /^\/api\/setup\/profile$/,       setup.postProfile],
  ['POST',  /^\/api\/setup\/portals$/,       setup.postPortals],
  ['GET',   /^\/api\/applications$/,          applications.list],
  ['GET',   /^\/api\/applications\/([^/]+)$/, applications.getOne],
  ['PATCH', /^\/api\/applications\/([^/]+)$/, applications.patch],
  ['GET',   /^\/api\/files\/(output|jds)\/(.+)$/, files.get],
];

async function handle(req, res) {
  if (!isAllowedRequest(req)) return sendJson(res, 403, { error: 'forbidden: foreign Host or cross-origin request' });
  const url = new URL(req.url, 'http://localhost');
  for (const [method, pattern, fn] of ROUTES) {
    if (req.method !== method) continue;
    const m = url.pathname.match(pattern);
    if (m) {
      try { return await fn(req, res, m.slice(1)); }
      catch (e) { return sendJson(res, 500, { error: e.message }); }
    }
  }
  if (req.method === 'GET') {
    // ponytail: web/index.html loads /style.css and /app.js by absolute path,
    // so misses in ui/dist fall through to web/. Delete with web/ in M4.
    const rel = url.pathname === '/' ? 'index.html'
      : url.pathname === '/legacy' ? null
      : normalize(url.pathname).replace(/^[/\\]+/, '');
    if (rel === null) { if (await serveStatic(res, join(LEGACY_DIR, 'index.html'))) return; }
    else {
      for (const dir of [WEB_DIR, LEGACY_DIR]) {
        const file = join(dir, rel);
        if (file.startsWith(dir) && await serveStatic(res, file)) return;
      }
    }
  }
  sendJson(res, 404, { error: 'not found' });
}

export function createServer() { return http.createServer(handle); }

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.CAREER_OPS_WEB_PORT) || 3700;
  createServer().listen(port, '127.0.0.1', () =>
    console.log(`career-ops web UI → http://127.0.0.1:${port}`));
}
