// Local preview server: static files + POST /api/order (same handler Vercel runs).
// No mail is sent unless SMTP_* env vars are set; orders land in ./_outbox.
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.dirname(fileURLToPath(import.meta.url));

// Load .env (local secrets + test settings). Never committed; see .gitignore.
const envText = await readFile(path.join(ROOT, '.env'), 'utf8').catch(() => '');
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
}
const { default: orderHandler } = await import('./api/order.js');
if (process.env.KERST_TEST_MODE === '1') console.log(`[kerst] TEST MODE: ${process.env.KERST_TEST_AUTOSEND === '1' ? 'orders are SENT immediately (marked TEST ORDER)' : 'orders go to _outbox for review'}, restaurant copy cc ${process.env.KERST_TEST_CC || '(none)'}`);
const PORT = Number(process.env.PORT || 5510);
const vercel = JSON.parse(await readFile(path.join(ROOT, 'vercel.json'), 'utf8').catch(() => '{}'));
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
const BLOCKED = /^\/(api|_outbox|node_modules|\.git|\.claude)(\/|$)|\.mjs$|^\/package/;

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = decodeURIComponent(url.pathname);

  if (p === '/api/order') return orderHandler(req, res);

  const redirect = (vercel.redirects || []).find(r => r.source === p);
  if (redirect) { res.writeHead(redirect.permanent ? 308 : 307, { Location: redirect.destination }); return res.end(); }

  if (BLOCKED.test(p)) { res.writeHead(404); return res.end('Not found'); }
  let file = path.normalize(path.join(ROOT, p === '/' ? 'index.html' : p));
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  try {
    if ((await stat(file)).isDirectory()) file = path.join(file, 'index.html');
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found');
  }
}).listen(PORT, () => console.log(`Da Silvano dev server on http://localhost:${PORT}`));
