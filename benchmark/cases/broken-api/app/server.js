#!/usr/bin/env node
/**
 * Benchmark case: broken-api.
 *
 * Clicking "Place order" POSTs to /api/order. The handler has a deliberate
 * one-line bug — it reads `body.item.sku` but the request body never
 * carries an `item` field, only `quantity` — so it throws on every request
 * and the endpoint always 500s. The flow's network_request_success
 * assertion on /api/order then fails with a network_failure.
 *
 * Zero dependencies, one file, must listen on process.env.PORT.
 */

const http = require('http');

const PORT = Number(process.env.PORT) || 3954;

const HOME_HTML = `<!doctype html>
<html>
  <head><title>Checkout</title></head>
  <body>
    <h1>Your order</h1>
    <button data-testid="place-order" onclick="
      fetch('/api/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quantity: 1 })
      }).then(function (res) {
        document.getElementById('status').textContent = res.ok ? 'Order placed' : 'Order failed';
      }).catch(function () {
        document.getElementById('status').textContent = 'Order failed';
      });
    ">Place order</button>
    <p id="status"></p>
  </body>
</html>`;

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

const server = http.createServer((req, res) => {
  if (req.url === '/favicon.ico') {
    res.writeHead(204);
    return res.end();
  }
  if (req.url === '/api/order' && req.method === 'POST') {
    readBody(req).then((body) => {
      // Bug: `body.item` is never sent by the client — this always throws.
      const sku = body.item.sku;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, sku, quantity: body.quantity }));
    }).catch(() => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'internal server error' }));
    });
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(HOME_HTML);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`broken-api app listening on http://127.0.0.1:${PORT}`);
});
