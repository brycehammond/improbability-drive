#!/usr/bin/env node
/**
 * Serves `dist/` locally with the production routing and headers, so the CSP
 * and the `/r/<blob>` rewrite are testable without deploying.
 *
 * There is no API here. Pages run in mock mode (`?mock=1`) against it; for
 * the real endpoint use `npm run dev`, which starts the SWA emulator with the
 * function alongside.
 *
 * Resolution order: exact file -> <path>/index.html -> <path>.html ->
 * /r/* -> r.html -> 404. With PORT=0 it binds an ephemeral port and prints
 * the origin once listening, which is how the test suite finds it.
 */
import { createServer } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.resolve(ROOT, process.env.PREVIEW_DIR ?? 'dist');
const HOST = process.env.HOST ?? '127.0.0.1';
const PORT = process.env.PORT === undefined ? 8787 : Number(process.env.PORT);

const CONTENT_TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.json', 'application/json; charset=utf-8'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.ico', 'image/x-icon'],
]);
const contentType = (file) => CONTENT_TYPES.get(path.extname(file).toLowerCase()) ?? 'text/plain; charset=utf-8';

function globalHeaders() {
  const file = path.join(DIST, '_headers');
  if (!fs.existsSync(file)) return {};
  const out = {};
  let inGlobal = false;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (!/^\s/.test(line)) { inGlobal = line.trim() === '/*'; continue; }
    if (!inGlobal) continue;
    const at = line.indexOf(':');
    if (at > 0) out[line.slice(0, at).trim().toLowerCase()] = line.slice(at + 1).trim();
  }
  return out;
}
const EXTRA_HEADERS = globalHeaders();

function resolveFile(pathname) {
  const clean = path.posix.normalize(decodeURIComponent(pathname)).replace(/^\/+/, '');
  if (clean.startsWith('..')) return null;
  const candidate = path.join(DIST, clean);
  if (!candidate.startsWith(DIST)) return null;
  const isFile = (p) => fs.existsSync(p) && fs.statSync(p).isFile();

  if (clean === '' || clean.endsWith('/')) {
    const index = path.join(candidate, 'index.html');
    return isFile(index) ? index : null;
  }
  if (isFile(candidate)) return candidate;
  if (isFile(path.join(candidate, 'index.html'))) return path.join(candidate, 'index.html');
  if (isFile(`${candidate}.html`)) return `${candidate}.html`;
  if (clean === 'r' || clean.startsWith('r/')) return path.join(DIST, 'r.html');
  return null;
}

const plain = (res, status, message) => {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' });
  res.end(`${message}\n`);
};

const server = createServer((req, res) => {
  let url;
  try { url = new URL(req.url ?? '/', `http://${req.headers.host ?? HOST}`); } catch { return plain(res, 400, '400 Bad Request'); }
  let file;
  try { file = resolveFile(url.pathname); } catch { return plain(res, 400, `400 Bad Request: ${url.pathname}`); }
  if (!file) return plain(res, 404, `404 Not Found: ${url.pathname}`);
  const body = fs.readFileSync(file);
  res.writeHead(200, { ...EXTRA_HEADERS, 'content-type': contentType(file), 'content-length': body.length, 'cache-control': 'no-store' });
  if (req.method === 'HEAD') res.end(); else res.end(body);
});

if (!fs.existsSync(DIST)) {
  process.stderr.write('nothing to serve. Run `npm run build` first\n');
  process.exit(1);
}

server.listen(PORT, HOST, () => {
  const { port } = server.address();
  process.stdout.write(`serving dist/ on http://${HOST}:${port}\n`);
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
