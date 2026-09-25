// server/lib/http.mjs
import { createReadStream } from 'fs';
import { writeFile, rename, stat } from 'fs/promises';
import { dirname, join, extname } from 'path';

const TYPES = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css',
  '.json':'application/json', '.svg':'image/svg+xml', '.md':'text/markdown' };

export function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    let done = false;
    const finish = (fn, val) => { if (!done) { done = true; fn(val); } };
    req.on('data', c => {
      if (done) return;
      data += c;
      if (data.length > 8e6) { req.destroy(); finish(reject, new Error('payload too large (>8MB)')); }
    });
    req.on('end', () => {
      if (done) return;
      try { finish(resolve, data ? JSON.parse(data) : {}); } catch (e) { finish(reject, e); }
    });
    req.on('error', e => finish(reject, e));
  });
}

export function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let done = false;
    const finish = (fn, val) => { if (!done) { done = true; fn(val); } };
    req.on('data', c => {
      if (done) return;
      size += c.length;
      if (size > 8e6) { req.destroy(); finish(reject, new Error('payload too large (>8MB)')); return; }
      chunks.push(Buffer.from(c));
    });
    req.on('end', () => finish(resolve, Buffer.concat(chunks)));
    req.on('error', e => finish(reject, e));
  });
}

export function sendJson(res, status, obj) {
  let body;
  try { body = JSON.stringify(obj); }
  catch { status = 500; body = JSON.stringify({ error: 'response serialization failed' }); }
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) });
  res.end(body);
}

export async function serveStatic(res, absFile) {
  try {
    const s = await stat(absFile);
    if (!s.isFile()) return false;
  } catch { return false; }
  res.writeHead(200, { 'content-type': TYPES[extname(absFile)] || 'application/octet-stream' });
  createReadStream(absFile).pipe(res);
  return true;
}

export async function atomicWrite(absPath, content) {
  const tmp = join(dirname(absPath), `.tmp-${process.pid}-${Date.now()}`);
  await writeFile(tmp, content, 'utf-8');
  await rename(tmp, absPath);
}
