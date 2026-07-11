#!/usr/bin/env node
/**
 * Benchmark case: text-changed.
 *
 * The copy team changed the homepage greeting from "Welcome back" to "Good
 * to see you". The flow's text_visible assertion still checks for the old
 * copy, so it fails with a text_mismatch.
 *
 * Zero dependencies, one file, must listen on process.env.PORT.
 */

const http = require('http');

const PORT = Number(process.env.PORT) || 3955;

const HOME_HTML = `<!doctype html>
<html>
  <head><title>Home</title></head>
  <body>
    <h1 data-testid="greeting">Good to see you</h1>
  </body>
</html>`;

const server = http.createServer((req, res) => {
  if (req.url === '/favicon.ico') {
    res.writeHead(204);
    return res.end();
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(HOME_HTML);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`text-changed app listening on http://127.0.0.1:${PORT}`);
});
