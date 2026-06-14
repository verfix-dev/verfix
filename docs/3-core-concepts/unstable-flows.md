# Unstable (Flaky) Flows

## What Does "Unstable" Mean?

When Verfix marks a verification as **unstable**, it means the exact same check — same task, same website — gives **different results on different runs**. Sometimes it passes, sometimes it fails, and the failures happen for different reasons each time.

Think of it like a light switch that works most of the time, but occasionally flickers. The problem isn't that the light is broken (that would be a consistent failure) — it's that the light is *unreliable*.

## A Simple Example

You ask Verfix to verify that a login page loads correctly on `https://myapp.com`.

| Run | Result | Error |
|-----|--------|-------|
| 1   | ✅ Passed | — |
| 2   | ❌ Failed | Page took too long to load |
| 3   | ✅ Passed | — |
| 4   | ❌ Failed | Button "Sign In" not found |
| 5   | ✅ Passed | — |

This flow is **unstable** because:
- It sometimes passes and sometimes fails (mixed results)
- The failures have **different reasons** each time (timeout vs. missing element)

## What Is NOT Unstable

Verfix is careful about this label. Not every failed check is unstable:

### Consistent failure ≠ Unstable

| Run | Result | Error |
|-----|--------|-------|
| 1   | ❌ Failed | `net::ERR_CONNECTION_REFUSED` |
| 2   | ❌ Failed | `net::ERR_CONNECTION_REFUSED` |
| 3   | ❌ Failed | `net::ERR_CONNECTION_REFUSED` |

This is a **real, consistent problem** — the server is down or rejecting connections every time. Verfix does NOT label this as unstable because the failure is predictable and repeatable. Fix the server, and the check will pass.

### Different tasks on the same URL are independent

| Task | URL | Result |
|------|-----|--------|
| "Check login page loads" | `https://myapp.com` | ✅ Always passes |
| "Verify checkout flow" | `https://myapp.com` | ❌ Unstable |

Even though both tasks target the same website, they are tracked independently. The login check being stable doesn't affect the checkout flow's instability, and vice versa.

## How Verfix Detects Instability

Verfix uses two criteria to decide if a flow is unstable:

1. **Mixed outcomes**: The same task+URL combination has both passing AND failing runs (at least 2 total runs).

2. **Diverse failure reasons**: The failures have more than one distinct error. If every failure has the identical error message, it's a deterministic bug — not instability.

Both conditions must be true. This prevents false positives where a real bug gets mislabeled as instability.

## What Causes Instability?

Unstable flows usually point to one of these root causes:

| Cause | Description | Example |
|-------|-------------|---------|
| **Race conditions** | The page loads elements in unpredictable order | A button appears before its container is ready |
| **Slow API responses** | Backend responses vary in speed | Login works when the API is fast, times out when it's slow |
| **Dynamic content** | Content changes between page loads | A/B tests, rotating banners, randomized layouts |
| **Third-party dependencies** | External scripts load unreliably | Analytics, chat widgets, CDN assets |
| **Infrastructure variance** | Server performance fluctuates | High load causes intermittent timeouts |

## What Should You Do About It?

1. **Look at the failure details**: Open the unstable execution and check the Assertions and Console tabs. Compare what went wrong across different failed runs.

2. **Check the pattern**: The Unstable Results banner shows pass/fail counts and failure rate. A 90% failure rate is likely a real bug that occasionally gets lucky. A 10% failure rate is likely a timing or infrastructure issue.

3. **Common fixes**:
   - Add wait conditions or increase timeouts for slow-loading pages
   - Use more stable selectors (`data-testid` instead of CSS classes that change)
   - Isolate third-party script issues
   - Check if the server has intermittent performance problems

## Where You'll See the Unstable Label

- **Sidebar**: An orange `· unstable` tag next to the execution status
- **Detail view**: A yellow "Unstable Results Detected" banner with pass/fail statistics
- **Search filter**: The `unstable` filter in the search overlay shows only unstable executions
- **Metrics page**: The "Unstable Flows" card shows how many of your flows are unreliable

## Technical Details

For developers and contributors, the detection logic lives in:

- **Backend**: `api/main.go` → `handleFlaky()` — SQL queries group by `(task, url)` and require `COUNT(DISTINCT COALESCE(error_message, '__assertion_failure__')) > 1`
- **Worker**: `workers/src/reliability/retry.ts` — Error classification (`transient`, `deterministic`, `unknown`) determines retry behavior and feeds into the error_message stored for flaky comparison
- **Frontend**: `dashboard/src/context/WorkspaceContext.tsx` — Consumes `failed_execution_ids` from the `/api/v1/flaky` endpoint to tag individual executions
