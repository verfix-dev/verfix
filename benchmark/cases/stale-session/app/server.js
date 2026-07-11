#!/usr/bin/env node
/**
 * Benchmark case: stale-session.
 *
 * A minimal cookie-based auth app. /login sets a "token" cookie holding
 * whatever the server currently considers valid; /private fetches
 * /api/session (an auth-ish endpoint per the stale_session analyzer's URL
 * regex) which 401s unless the cookie matches the server's current token —
 * simulating a rotated/expired session. On 401 the private page renders
 * "Session expired" instead of the real content.
 *
 * The benchmark workspace ships a PRE-BAKED .verfix/state/auth.json holding a
 * cookie value the server no longer accepts (CURRENT_TOKEN below is what a
 * fresh /login would actually issue) — so the first run of the `private` flow
 * (the only flow in verfix.config.json) fails with a stale_session finding
 * without ever running a login flow.
 *
 * Zero dependencies, one file, must listen on process.env.PORT.
 */

const http = require('http');

const PORT = Number(process.env.PORT) || 3950;

// The only token the server currently accepts. The pre-baked state file
// carries an older, now-rejected value ("old-token-v1") — mirroring a
// rotated or expired session.
const CURRENT_TOKEN = 'current-token-v2';

const HOME_HTML = `<!doctype html>
<html>
  <head><title>Stale Session Demo</title></head>
  <body>
    <h1>Welcome</h1>
    <p><a href="/login">Log in</a> or <a href="/private">go to private area</a></p>
  </body>
</html>`;

const LOGIN_HTML = `<!doctype html>
<html>
  <head><title>Log in</title></head>
  <body>
    <button data-testid="login-btn" onclick="document.cookie='token=${CURRENT_TOKEN}; path=/'; document.getElementById('status').textContent='Logged in';">Log in</button>
    <p id="status"></p>
  </body>
</html>`;

const PRIVATE_HTML = `<!doctype html>
<html>
  <head><title>Private</title></head>
  <body>
    <div id="content">Loading...</div>
    <script>
      fetch('/api/session').then(function (res) {
        if (res.ok) {
          document.getElementById('content').innerHTML = '<span data-testid="private-ok">Private content</span>';
        } else {
          document.getElementById('content').textContent = 'Session expired';
        }
      }).catch(function () {
        document.getElementById('content').textContent = 'Session expired';
      });
    </script>
  </body>
</html>`;

function parseCookies(header) {
  const out = {};
  (header || '').split(';').forEach((pair) => {
    const idx = pair.indexOf('=');
    if (idx === -1) return;
    out[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
  });
  return out;
}

const server = http.createServer((req, res) => {
  if (req.url === '/favicon.ico') {
    res.writeHead(204);
    return res.end();
  }
  if (req.url === '/api/session') {
    const cookies = parseCookies(req.headers.cookie);
    if (cookies.token === CURRENT_TOKEN) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true }));
    }
    res.writeHead(401, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: false, error: 'invalid or expired session' }));
  }
  if (req.url === '/login') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(LOGIN_HTML);
  }
  if (req.url === '/private') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(PRIVATE_HTML);
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(HOME_HTML);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`stale-session app listening on http://127.0.0.1:${PORT}`);
});
