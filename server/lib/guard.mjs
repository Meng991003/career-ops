// server/lib/guard.mjs
// Localhost CSRF + DNS-rebinding guard. Any website the user visits can POST to
// 127.0.0.1 (a text/plain body skips the CORS preflight), and a rebinding
// domain can make GETs look same-origin. So: Host must be ours on every request,
// and every state-changing request must carry an Origin that is ours too.
// Browsers always send Origin on POST/PATCH/PUT/DELETE; a missing one means a
// non-browser client, which must opt in by sending it.
export function isAllowedRequest(req) {
  const port = req.socket?.localPort;
  const ours = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  if (!ours.has(req.headers.host)) return false;
  if (req.method === 'GET' || req.method === 'HEAD') return true;
  const origin = req.headers.origin;
  if (!origin) return false;
  try { return ours.has(new URL(origin).host); } catch { return false; }
}
