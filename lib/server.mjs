import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.mp3': 'audio/mpeg', '.wav': 'audio/wav'
};

/** Static server rooted at `root` (127.0.0.1 only, range requests for video). */
export function serve(root, port = 0) {
  root = path.resolve(root);
  const server = http.createServer((req, res) => {
    try {
      const u = new URL(req.url, 'http://x');
      let rel = decodeURIComponent(u.pathname);
      if (rel.endsWith('/')) rel += 'index.html';
      const file = path.join(root, rel);
      if (!file.startsWith(root) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end('not found'); return; }
      const stat = fs.statSync(file);
      const head = { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store', 'Accept-Ranges': 'bytes', 'Access-Control-Allow-Origin': '*' };
      const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
      if (range) {
        const start = range[1] ? +range[1] : 0, end = range[2] ? Math.min(+range[2], stat.size - 1) : stat.size - 1;
        res.writeHead(206, { ...head, 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Content-Length': end - start + 1 });
        fs.createReadStream(file, { start, end }).pipe(res);
      } else {
        res.writeHead(200, { ...head, 'Content-Length': stat.size });
        fs.createReadStream(file).pipe(res);
      }
    } catch (e) { res.writeHead(500); res.end(String(e)); }
  });
  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const { port: p } = server.address();
      resolve({ port: p, origin: `http://127.0.0.1:${p}`, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(() => r()); }) });
    });
  });
}
