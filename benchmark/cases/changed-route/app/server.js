#!/usr/bin/env node
/**
 * Benchmark case: changed-route.
 *
 * The dashboard page was renamed from /dashboard to /overview as part of a
 * navigation refactor — /dashboard now redirects to the new location instead
 * of 404ing outright, so navigation itself succeeds but the final URL no
 * longer contains "dashboard". The flow's url_contains assertion (written
 * against the old path) then fails with a url_mismatch.
 *
 * Zero dependencies, one file, must listen on process.env.PORT.
 */

const http = require('http');

const PORT = Number(process.env.PORT) || 3952;

const OVERVIEW_HTML = `<!doctype html>
<html>
  <head><title>Overview</title></head>
  <body>
    <h1>Dashboard Overview</h1>
    <p>Everything looks good.</p>
  </body>
</html>`;

const HOME_HTML = `<!doctype html>
<html>
  <head><title>Home</title></head>
  <body>
    <h1>Home</h1>
    <p><a href="/overview">Go to dashboard</a></p>
  </body>
</html>`;

const server = http.createServer((req, res) => {
  if (req.url === '/favicon.ico') {
    res.writeHead(204);
    return res.end();
  }
  if (req.url === '/dashboard') {
    res.writeHead(302, { Location: '/overview' });
    return res.end();
  }
  if (req.url === '/overview') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(OVERVIEW_HTML);
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(HOME_HTML);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`changed-route app listening on http://127.0.0.1:${PORT}`);
});
