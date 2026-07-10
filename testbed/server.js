#!/usr/bin/env node
/**
 * Verfix testbed — the tiny app this repo dogfoods itself against.
 *
 * Zero dependencies, one file: serves three pages that exercise the step
 * surface (type, click, wait_for_url, select_option, check, hover) and the
 * assertion surface (page_loaded, text_visible incl. scoped, selector_visible,
 * url_contains, no_console_errors, selector_count).
 *
 * Used by CI (.github/workflows/ci.yml) and the documented local smoke test:
 *   node testbed/server.js &
 *   cd cli && npx ts-node src/index.ts run --config ../testbed/verfix.config.json --flow login --output json
 */

const http = require('http');

const PORT = Number(process.env.PORT) || 3947;

const HOME_HTML = `<!doctype html>
<html>
  <head><title>Verfix Testbed</title></head>
  <body>
    <h1 data-testid="heading">Verfix Testbed</h1>
    <p>A tiny app the Verfix repo verifies itself against.</p>
    <a href="/login" data-testid="nav-login">Log in</a>

    <fieldset>
      <legend>Form controls</legend>
      <select data-testid="plan">
        <option value="">Choose a plan…</option>
        <option value="free">Free</option>
        <option value="pro">Pro</option>
      </select>
      <label><input type="checkbox" data-testid="tos"> Accept terms</label>
      <button type="button" data-testid="hover-hint">Hover for hint</button>
    </fieldset>

    <p data-testid="plan-status"></p>
    <p data-testid="tos-status"></p>
    <p data-testid="hint-status"></p>

    <ul>
      <li class="todo-item">Write flows</li>
      <li class="todo-item">Run verify</li>
      <li class="todo-item">Ship it</li>
    </ul>

    <script>
      const el = (id) => document.querySelector('[data-testid="' + id + '"]');
      el('plan').addEventListener('change', (e) => {
        el('plan-status').textContent = 'Plan selected: ' + e.target.value;
      });
      el('tos').addEventListener('change', (e) => {
        el('tos-status').textContent = e.target.checked ? 'Terms accepted' : 'Terms declined';
      });
      el('hover-hint').addEventListener('mouseenter', () => {
        el('hint-status').textContent = 'Hint revealed';
      });
    </script>
  </body>
</html>`;

const LOGIN_HTML = `<!doctype html>
<html>
  <head><title>Log in — Verfix Testbed</title></head>
  <body>
    <h1>Log in</h1>
    <form id="login">
      <input id="username" placeholder="Username" />
      <input id="password" type="password" placeholder="Password" />
      <button type="submit">Sign in</button>
    </form>
    <p id="error" hidden>Invalid credentials</p>
    <script>
      document.getElementById('login').addEventListener('submit', (e) => {
        e.preventDefault();
        const u = document.getElementById('username').value;
        const p = document.getElementById('password').value;
        if (u === 'verfix' && p === 's3cret') {
          window.location.href = '/secure';
        } else {
          document.getElementById('error').hidden = false;
        }
      });
    </script>
  </body>
</html>`;

const SECURE_HTML = `<!doctype html>
<html>
  <head><title>Secure — Verfix Testbed</title></head>
  <body>
    <h2 data-testid="welcome">Welcome back, verfix</h2>
    <p>You are in the secure area.</p>
  </body>
</html>`;

const server = http.createServer((req, res) => {
  const path = (req.url || '/').split('?')[0];
  if (path === '/favicon.ico') {
    // 204, not 404: a missing favicon logs a console error in Chromium and
    // would force every no_console_errors assertion to carry an exclude.
    res.writeHead(204);
    return res.end();
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  if (path === '/login') return res.end(LOGIN_HTML);
  if (path === '/secure') return res.end(SECURE_HTML);
  res.end(HOME_HTML);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Verfix testbed listening on http://127.0.0.1:${PORT}`);
});
