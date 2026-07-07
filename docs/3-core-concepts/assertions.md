# Assertions

Assertions are the core mechanism for verifying application state in Strict and Assisted modes. 

## Supported Assertions

- `page_loaded`: Verifies the page navigated successfully (not blank/errored).
- `selector_visible`: Verifies a specific element is present and visible in the DOM.
- `text_visible`: Verifies text is visible anywhere on the page. Add `selector` to scope the search — see below.
- `url_contains`: Verifies the current URL contains a specific substring.
- `title_contains`: Verifies the page title contains a substring.
- `no_console_errors`: Verifies no `console.error` lines were logged. See `exclude` below to allow known-noisy errors.
- `network_request_success`: Verifies every request matching a URL substring returned 200–399. See `acceptStatuses` below to allow other expected statuses.

## Structured Definition

Assertions are passed in the job payload as a JSON array:

```json
"assertions": [
  {
    "type": "url_contains",
    "value": "/dashboard"
  },
  {
    "type": "selector_visible",
    "selector": "submit-btn"
  }
]
```

## Handling expected non-2xx responses and known-noisy console errors

Some flows have more than one valid outcome — e.g. a login endpoint that returns
`200` on success or `409` when a session is already active. Rather than
branching the flow, tell the assertion which statuses are expected:

```json
{
  "type": "network_request_success",
  "value": "/api/auth/login",
  "acceptStatuses": [200, 409]
}
```

`acceptStatuses` replaces the default 200–399 range entirely when set — list
every status you want to accept. Similarly, `exclude` on `no_console_errors`
ignores console errors matching any of the given regex patterns (e.g. a known
third-party script warning), without silencing every error:

```json
{
  "type": "no_console_errors",
  "exclude": ["ACTIVE_SESSION_EXISTS"]
}
```

## Scoping text_visible when text appears more than once

Real pages repeat text — a stats-card title may also appear in a caption or
nav item. `text_visible` passes when *any* visible occurrence matches. To
assert the text appears in a specific place, add `selector` to scope the
search to matches inside that element:

```json
{
  "type": "text_visible",
  "value": "Total Declarations",
  "selector": "[data-testid=stats-card]"
}
```

Scoped, the assertion fails if the text is only visible elsewhere on the page.

Failure `detail`/`fix_hint` text for both assertions now names the concrete
matched request (method, URL, status) or console error text, instead of a
generic message — so an agent can decide whether to add the exception above
or treat it as a real bug.

## AI Agent Consumption

Verfix returns structured assertion results. Agents consume these results to determine if their code changes successfully resolved an issue.

```json
{
  "type": "element_visible",
  "passed": false,
  "error": "Timeout 5000ms exceeded",
  "fix_hint": "Element not found. Consider waiting for the DOM to stabilize."
}
```
