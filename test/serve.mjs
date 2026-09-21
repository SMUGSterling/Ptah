// serve.mjs — zero-dependency static server for renderer/.
// Used by the browser E2E runner and by `npm run web` for local use.
//
//   node test/serve.mjs            # serves renderer/ on http://localhost:8123
//   node test/serve.mjs 0          # random free port (printed)
//   node test/serve.mjs --open     # also opens the default browser (the launchers use this)

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'renderer');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.usda': 'text/plain; charset=utf-8'
};

export function startServer(port = 0) {
  const server = http.createServer(async (req, res) => {
    try {
      let urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (urlPath.endsWith('/')) urlPath += 'index.html';
      const file = path.normalize(path.join(ROOT, urlPath));
      if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
      const data = await fs.readFile(file);
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
        'Cache-Control': 'no-store'
      });
      res.end(data);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('not found');
    }
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const actual = server.address().port;
      resolve({ server, port: actual, url: `http://127.0.0.1:${actual}/` });
    });
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  const open = args.includes('--open');
  const portArg = args.find(a => /^\d+$/.test(a));
  const want = portArg != null ? Number(portArg) : 8123;
  let started;
  try { started = await startServer(want); }
  catch (err) {                                   // 8123 busy (another Ptah?): take any free port
    if (err.code !== 'EADDRINUSE') throw err;
    started = await startServer(0);
  }
  const { url } = started;
  console.log(`\n  Ptah web build is running at  ${url}\n  Leave this window open while you work; close it to stop.\n`);
  if (open) {
    const { spawn } = await import('node:child_process');
    const cmd = process.platform === 'darwin' ? ['open', [url]]
      : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
      : ['xdg-open', [url]];
    try { spawn(cmd[0], cmd[1], { stdio: 'ignore', detached: true }).on('error', () => {}).unref(); } catch { /* print the URL and let the person open it */ }
  }
}
