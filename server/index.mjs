// server/index.mjs
import http from 'http';
import { fileURLToPath } from 'url';
import { dirname, join, normalize } from 'path';
import { serveStatic, sendJson } from './lib/http.mjs';
import { REPO_ROOT } from './lib/paths.mjs';
import * as setup from './routes/setup.mjs';
import * as applications from './routes/applications.mjs';

const WEB_DIR = join(REPO_ROOT, 'web');

// [method, pattern(RegExp), handler(req,res,params)]
const ROUTES = [
  ['GET',   /^\/api\/setup\/status$/,        setup.getStatus],
  ['POST',  /^\/api\/setup\/cv$/,            setup.postCv],
  ['POST',  /^\/api\/setup\/profile$/,       setup.postProfile],
  ['POST',  /^\/api\/setup\/portals$/,       setup.postPortals],
  ['GET',   /^\/api\/applications$/,          applications.list],
  ['GET',   /^\/api\/applications\/([^/]+)$/, applications.getOne],
  ['PATCH', /^\/api\/applications\/([^/]+)$/, applications.patch],
];

async function handle(req, res) {
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
    const rel = url.pathname === '/' ? 'index.html' : normalize(url.pathname).replace(/^[/\\]+/, '');
    const file = join(WEB_DIR, rel);
    if (file.startsWith(WEB_DIR) && await serveStatic(res, file)) return;
  }
  sendJson(res, 404, { error: 'not found' });
}

export function createServer() { return http.createServer(handle); }

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.CAREER_OPS_WEB_PORT) || 3700;
  createServer().listen(port, '127.0.0.1', () =>
    console.log(`career-ops web UI → http://127.0.0.1:${port}`));
}
