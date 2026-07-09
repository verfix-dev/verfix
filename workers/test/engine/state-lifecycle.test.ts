/**
 * State lifecycle regression test (real Chromium, no AI, no transports).
 *
 * Simulates the failure modes reported against saveState/useState with a mini
 * app whose backend uses single-use (rotating) tokens:
 *  1. saveState persists a verified session.
 *  2. useState restores it, and the file is refreshed after the run so the
 *     rotated token on disk never goes stale (refresh-on-use).
 *  3. A second useState run still passes — the old behavior restored the
 *     already-consumed token and failed.
 *  4. A clearState flow batched BEFORE a useState flow gets a clean slate —
 *     the old behavior restored state at context creation, before any flow.
 *  5. refreshState: false leaves the state file untouched.
 */

import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { runVerification, shutdownEngine, Flow } from '../../src/engine';

const PAGE = `<!doctype html>
<title>rotating-token app</title>
<div id="status" class="boot">booting</div>
<button id="login">login</button>
<script>
(async () => {
  const status = document.getElementById('status');
  const set = (cls) => { status.className = cls; status.textContent = cls; };
  const t = localStorage.getItem('token');
  if (t) {
    const res = await fetch('/rotate?t=' + encodeURIComponent(t));
    if (res.ok) { localStorage.setItem('token', await res.text()); set('in'); }
    else { localStorage.removeItem('token'); set('out'); }
  } else {
    set('out');
  }
  document.getElementById('login').onclick = async () => {
    const res = await fetch('/token');
    localStorage.setItem('token', await res.text());
    set('in');
  };
})();
</script>`;

function startServer(): Promise<{ url: string; close: () => void }> {
  let seq = 0;
  const used = new Set<string>();
  const issue = () => `t${seq++}`;
  const server = http.createServer((req, res) => {
    const u = new URL(req.url || '/', 'http://localhost');
    if (u.pathname === '/token') {
      res.writeHead(200, { 'content-type': 'text/plain' }).end(issue());
    } else if (u.pathname === '/rotate') {
      const t = u.searchParams.get('t') || '';
      if (used.has(t) || !t.startsWith('t')) {
        res.writeHead(401).end('token already used');
      } else {
        used.add(t);
        res.writeHead(200, { 'content-type': 'text/plain' }).end(issue());
      }
    } else {
      res.writeHead(200, { 'content-type': 'text/html' }).end(PAGE);
    }
  });
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      resolve({ url: `http://127.0.0.1:${addr.port}`, close: () => server.close() });
    });
  });
}

let runSeq = 0;
async function run(url: string, dir: string, flows: Flow[]) {
  return runVerification(
    {
      id: `state_test_${runSeq++}`,
      task: 'state lifecycle test',
      url,
      mode: 'strict',
      timeout: 8000,
      flows,
    },
    { artifactsDir: path.join(dir, 'runs'), stateDir: path.join(dir, 'state'), headless: true },
  );
}

function stateToken(dir: string): string {
  const state = JSON.parse(fs.readFileSync(path.join(dir, 'state', 'auth.json'), 'utf-8'));
  const origin = (state.origins || [])[0];
  const entry = (origin?.localStorage || []).find((e: any) => e.name === 'token');
  if (!entry) throw new Error('no token in saved state');
  return entry.value;
}

function assert(cond: unknown, msg: string): void {
  if (!cond) {
    console.error(`❌ ${msg}`);
    process.exit(1);
  }
  console.log(`✓ ${msg}`);
}

const loggedIn = { type: 'selector_visible' as const, selector: '#status.in', timeout: 5000 };
const loggedOut = { type: 'selector_visible' as const, selector: '#status.out', timeout: 5000 };

const loginFlow: Flow = {
  name: 'login',
  steps: [{ action: 'click', target: { selector: '#login' } }],
  assertions: [loggedIn],
  saveState: 'auth',
};
const dashFlow: Flow = { name: 'dash', steps: [], assertions: [loggedIn], useState: 'auth' };
const freshFlow: Flow = { name: 'fresh', steps: [], assertions: [loggedOut], clearState: true };

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'verfix-state-test-'));
  const { url, close } = await startServer();
  try {
    // 1. saveState persists a verified session.
    const a = await run(url, dir, [loginFlow]);
    assert(a.passed, 'login flow with saveState passes');
    const t0 = stateToken(dir);
    assert(!!t0, `state file holds the issued token (${t0})`);

    // 2. useState restores it; refresh-on-use rewrites the rotated token.
    const b = await run(url, dir, [dashFlow]);
    assert(b.passed, 'useState flow passes (fast path restore)');
    const t1 = stateToken(dir);
    assert(t1 !== t0, `state file was refreshed after use (${t0} → ${t1})`);

    // 3. The rotated token on disk keeps a second run alive — the core
    //    single-use-token regression.
    const c = await run(url, dir, [dashFlow]);
    assert(c.passed, 'second useState run still passes (rotating token survived)');
    const t2 = stateToken(dir);
    assert(t2 !== t1, 'state file refreshed again');

    // 4. clearState flow batched before a useState flow gets a clean slate,
    //    and the useState flow is restored right before it runs.
    const d = await run(url, dir, [freshFlow, dashFlow]);
    const byFlow = (name: string) => d.assertions.filter(r => r.flow_name === name);
    assert(byFlow('fresh').every(r => r.passed), 'clearState flow saw a clean slate (no pre-restored session)');
    assert(byFlow('dash').every(r => r.passed), 'useState flow after it was restored per-flow and passed');
    assert(d.passed, 'batched clearState + useState run passes end-to-end');

    // 5. refreshState: false leaves the file untouched.
    const before = fs.readFileSync(path.join(dir, 'state', 'auth.json'), 'utf-8');
    const e = await run(url, dir, [{ ...dashFlow, refreshState: false }]);
    assert(e.passed, 'useState flow with refreshState: false passes');
    const after = fs.readFileSync(path.join(dir, 'state', 'auth.json'), 'utf-8');
    assert(before === after, 'refreshState: false left the state file untouched');

    console.log('\n✅ state-lifecycle: all checks passed');
  } finally {
    close();
    await shutdownEngine();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

main().catch(err => {
  console.error('❌ state-lifecycle test crashed:', err);
  process.exit(1);
});
