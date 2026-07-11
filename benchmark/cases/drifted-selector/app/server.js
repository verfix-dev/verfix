#!/usr/bin/env node
/**
 * Benchmark case: drifted-selector.
 *
 * A "refactor" renamed the order form's submit button from
 * data-testid="submit-btn" to data-testid="submit-order" — the button that
 * actually ships in the served HTML below only carries the new name. The
 * flow config (verfix.config.json, checked out with this case) still clicks
 * the old selector, so the first run must fail with selector_not_found.
 *
 * Zero dependencies, one file, mirrors testbed/server.js. Must listen on
 * process.env.PORT (the harness picks a free port per run).
 */

const http = require('http');

const PORT = Number(process.env.PORT) || 3948;

const HOME_HTML = `<!doctype html>
<html>
  <head><title>Checkout</title></head>
  <body>
    <h1 data-testid="heading">Your order</h1>
    <p>1x Verfix T-Shirt — $24.00</p>
    <button data-testid="submit-order" onclick="document.getElementById('status').textContent='Order submitted';">Submit order</button>
    <p id="status"></p>
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
  console.log(`drifted-selector app listening on http://127.0.0.1:${PORT}`);
});
