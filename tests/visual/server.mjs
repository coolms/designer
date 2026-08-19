/**
 * Tiny static file server for the visual-regression fixture.
 *
 * Serves the package root over HTTP so Playwright (Chromium) can
 * load the fixture HTML + the bundled fixture script + the
 * designer CSS as a same-origin tree. Zero npm dependencies on
 * purpose -- written against Node's built-in `node:http` /
 * `node:fs` so `playwright.config.ts`'s `webServer.command` can
 * spawn it without an extra `npm install` step.
 *
 * The server is intentionally NOT a general-purpose static host:
 *  - Only files inside the package root are served. Any path that
 *    escapes the root (via `..` traversal) returns 403.
 *  - No directory listings (a HEAD or GET on a directory 404s).
 *  - `Cache-Control: no-store` on every response so a code edit
 *    + re-build is visible on the next page reload without
 *    stale-cache surprises.
 *
 * Default port: 8085. Override via `PORT=...` env var. Playwright's
 * config plumbs the same env through.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(__dirname, '../..');
const PORT = Number(process.env.PORT ?? 8085);

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js':   'application/javascript; charset=utf-8',
    '.mjs':  'application/javascript; charset=utf-8',
    '.css':  'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg':  'image/svg+xml',
    '.png':  'image/png',
    '.map':  'application/json; charset=utf-8',
    '.txt':  'text/plain; charset=utf-8',
};

const DEFAULT_DOC = '/tests/visual/fixtures/index.html';

const server = http.createServer((req, res) => {
    let urlPath = (req.url ?? '/').split('?')[0];
    try {
        urlPath = decodeURIComponent(urlPath);
    } catch {
        res.writeHead(400).end('Bad request');
        return;
    }
    if (urlPath === '/') urlPath = DEFAULT_DOC;

    const filePath = path.resolve(PACKAGE_ROOT + urlPath);
    // Path traversal guard: resolved path must be inside the
    // package root. `path.resolve` collapses any `../` segments
    // so we can do a prefix check.
    if (filePath !== PACKAGE_ROOT && !filePath.startsWith(PACKAGE_ROOT + path.sep)) {
        res.writeHead(403).end('Forbidden');
        return;
    }

    fs.stat(filePath, (err, stat) => {
        if (err || !stat.isFile()) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Not found: ' + urlPath);
            return;
        }
        const ext = path.extname(filePath).toLowerCase();
        res.writeHead(200, {
            'Content-Type': MIME[ext] ?? 'application/octet-stream',
            'Cache-Control': 'no-store',
        });
        fs.createReadStream(filePath).pipe(res);
    });
});

server.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`[designer:visual] serving ${PACKAGE_ROOT} at http://localhost:${PORT}/`);
});
