#!/usr/bin/env node
/**
 * Benchmark case: console-error-breaks-render — fixed.
 *
 * The client-side fetch URL typo is corrected so it fetches "/api/items",
 * so the items load, the list renders, and the "Checkout" button appears.
 *
 * Zero dependencies, one file, must listen on process.env.PORT.
 */

const http = require('http');

const PORT = Number(process.env.PORT) || 3951;

const HOME_HTML = `<!doctype html>
<html>
  <head><title>Shop</title></head>
  <body>
    <h1>Your cart</h1>
    <ul id="items"></ul>
    <script>
      fetch('/api/items').then(function (res) {
        if (!res.ok) {
          console.error('Failed to load items: ' + res.status);
          return;
        }
        return res.json().then(function (items) {
          var ul = document.getElementById('items');
          items.forEach(function (item) {
            var li = document.createElement('li');
            li.textContent = item;
            ul.appendChild(li);
          });
          var btn = document.createElement('button');
          btn.setAttribute('data-testid', 'checkout');
          btn.textContent = 'Checkout';
          ul.appendChild(btn);
        });
      }).catch(function (err) {
        console.error('Failed to load items: ' + err.message);
      });
    </script>
  </body>
</html>`;

const server = http.createServer((req, res) => {
  if (req.url === '/favicon.ico') {
    res.writeHead(204);
    return res.end();
  }
  if (req.url === '/api/items') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(['Verfix T-Shirt', 'Verfix Mug']));
  }
  if (req.url && req.url.startsWith('/api/')) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'not found' }));
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(HOME_HTML);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`console-error-breaks-render app listening on http://127.0.0.1:${PORT}`);
});
