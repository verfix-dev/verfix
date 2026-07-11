#!/usr/bin/env node
/**
 * Benchmark case: occluding-modal.
 *
 * A "What's new" release-notes modal covers the full viewport on page load.
 * The checkout button underneath is present with the right selector, but the
 * modal's own stacking context intercepts the click, so the flow's click
 * step times out. The first run must carry a page_state fact naming the
 * open dialog and a blocking_overlay finding.
 *
 * Zero dependencies, one file, mirrors testbed/server.js. Must listen on
 * process.env.PORT (the harness picks a free port per run).
 */

const http = require('http');

const PORT = Number(process.env.PORT) || 3949;

const HOME_HTML = `<!doctype html>
<html>
  <head><title>Checkout</title></head>
  <body>
    <h1 data-testid="heading">Your cart</h1>
    <button data-testid="checkout" onclick="document.getElementById('status').textContent='Checked out';">Checkout</button>
    <p id="status"></p>

    <div role="dialog" aria-label="What's new" style="position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:1000;">
      <h2>What's new</h2>
      <p>We shipped a bunch of improvements this week.</p>
      <button data-testid="dismiss-whatsnew" onclick="this.closest('[role=dialog]').remove();">Close</button>
    </div>
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
  console.log(`occluding-modal app listening on http://127.0.0.1:${PORT}`);
});
