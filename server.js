/**
 * ═══════════════════════════════════════════════
 *  Baaz Audit — Local Server
 *  Static file server + CORS proxy for Snipe-IT
 * ═══════════════════════════════════════════════
 *
 *  Start:  node server.js
 *  Open:   http://localhost:3000
 *
 *  The /proxy endpoint forwards API requests to
 *  Snipe-IT so the browser doesn't hit CORS issues.
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = 3000;
const STATIC_DIR = __dirname;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept, X-Requested-With',
  'Access-Control-Max-Age': '86400',
};

const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url, true);

  // ── Handle CORS preflight for /proxy ──
  if (req.method === 'OPTIONS' && parsed.pathname === '/proxy') {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return;
  }

  // ── CORS Proxy endpoint ──
  if (parsed.pathname === '/proxy') {
    handleProxy(req, res, parsed);
    return;
  }

  // ── Static file serving ──
  serveStatic(req, res, parsed);
});

// ─────────────────────────────────────────
//  Static File Server
// ─────────────────────────────────────────

function serveStatic(req, res, parsed) {
  let filePath = path.join(STATIC_DIR, decodeURIComponent(parsed.pathname));

  // Default to index.html
  if (parsed.pathname === '/' || parsed.pathname === '') {
    filePath = path.join(STATIC_DIR, 'index.html');
  }

  // Security: prevent directory traversal
  if (!filePath.startsWith(STATIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  // Check if file exists
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    // Try appending index.html for directories
    const indexPath = path.join(filePath, 'index.html');
    if (fs.existsSync(indexPath)) {
      filePath = indexPath;
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found');
      return;
    }
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  try {
    const content = fs.readFileSync(filePath);
      res.writeHead(200, { 
        'Content-Type': contentType,
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      });
      res.end(content, 'utf-8');
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Internal Server Error');
  }
}

// ─────────────────────────────────────────
//  CORS Proxy
//  Usage: /proxy?target=https://example.com/api/v1/...
// ─────────────────────────────────────────

function handleProxy(req, res, parsed) {
  const target = parsed.query.target;

  if (!target) {
    res.writeHead(400, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Missing ?target= parameter' }));
    return;
  }

  // Validate URL
  let targetUrl;
  try {
    targetUrl = new URL(target);
  } catch {
    res.writeHead(400, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid target URL' }));
    return;
  }

  // Collect request body
  const bodyChunks = [];
  req.on('data', (chunk) => bodyChunks.push(chunk));
  req.on('end', () => {
    const body = Buffer.concat(bodyChunks);

    const protocol = targetUrl.protocol === 'https:' ? https : http;

    // Forward headers (clean up browser-specific ones)
    const forwardHeaders = {};
    for (const [key, val] of Object.entries(req.headers)) {
      const lower = key.toLowerCase();
      // Skip hop-by-hop and browser-specific headers
      if (['host', 'origin', 'referer', 'connection', 'accept-encoding'].includes(lower)) continue;
      forwardHeaders[key] = val;
    }
    forwardHeaders['host'] = targetUrl.host;

    const options = {
      hostname: targetUrl.hostname,
      port: targetUrl.port || (targetUrl.protocol === 'https:' ? 443 : 80),
      path: targetUrl.pathname + (targetUrl.search || ''),
      method: req.method,
      headers: forwardHeaders,
    };

    console.log(`[PROXY] Sending request to: ${targetUrl.href}`);

    const proxyReq = client.request(options, (proxyRes) => {
      console.log(`[PROXY] Received response from ${targetUrl.href} - Status: ${proxyRes.statusCode}`);

      // Build response headers: proxy response headers + CORS
      const responseHeaders = { ...CORS_HEADERS };
      for (const [key, val] of Object.entries(proxyRes.headers)) {
        const lower = key.toLowerCase();
        // Skip headers that conflict with our CORS headers
        if (lower.startsWith('access-control-')) continue;
        if (['transfer-encoding', 'connection'].includes(lower)) continue;
        responseHeaders[key] = val;
      }

      res.writeHead(proxyRes.statusCode, responseHeaders);
      proxyRes.pipe(res);
    });

    proxyReq.on('error', (err) => {
      console.error(`[PROXY ERROR] ${req.method} ${target} →`, err.message);
      res.writeHead(502, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'error',
        messages: `Proxy error: ${err.message}. Is the Snipe-IT server reachable? Check the URL.`,
      }));
    });

    if (body.length > 0) proxyReq.write(body);
    proxyReq.end();
  });
}

// ─── Start server ───
server.listen(PORT, () => {
  console.log('');
  console.log('  ╔═══════════════════════════════════════╗');
  console.log('  ║   BAAZ ASSET AUDIT SERVER             ║');
  console.log(`  ║   http://localhost:${PORT}               ║`);
  console.log('  ║   CORS Proxy: /proxy?target=URL       ║');
  console.log('  ╚═══════════════════════════════════════╝');
  console.log('');
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} already in use. Close the other process or change the port.`);
  } else {
    console.error('Server error:', err);
  }
  process.exit(1);
});
