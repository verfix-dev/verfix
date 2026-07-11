#!/usr/bin/env node
/**
 * Benchmark case: slow-endpoint.
 *
 * The page shows a spinner, fetches /api/report (which the server
 * deliberately delays ~7s before responding, simulating a slow report
 * generation job), then replaces the spinner with the report content. The
 * flow waits for the network to go idle with a 5s timeout — too short for
 * the real response time — so it times out before the report ever renders.
 *
 * Zero dependencies, one file, must listen on process.env.PORT.
 */

const http = require('http');

const PORT = Number(process.env.PORT) || 3953;
const REPORT_DELAY_MS = 7000;

const HOME_HTML = `<!doctype html>
<html>
  <head><title>Report</title></head>
  <body>
    <div id="content">Loading report...</div>
    <script>
      fetch('/api/report').then(function (res) {
        return res.json();
      }).then(function (data) {
        document.getElementById('content').textContent = 'Report ready: ' + data.summary;
      }).catch(function () {
        document.getElementById('content').textContent = 'Report failed to load';
      });
    </script>
  </body>
</html>`;

const server = http.createServer((req, res) => {
  if (req.url === '/favicon.ico') {
    res.writeHead(204);
    return res.end();
  }
  if (req.url === '/api/report') {
    setTimeout(() => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ summary: 'all systems nominal' }));
    }, REPORT_DELAY_MS);
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(HOME_HTML);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`slow-endpoint app listening on http://127.0.0.1:${PORT}`);
});
