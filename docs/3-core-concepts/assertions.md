# Assertions

Assertions are the core mechanism for verifying application state in Strict and Assisted modes. 

## Supported Assertions

- `url_contains`: Verifies the current URL contains a specific substring.
- `element_visible`: Verifies a specific element is present and visible in the DOM.
- `text_exists`: Verifies text exists anywhere on the page.

## Structured Definition

Assertions are passed in the job payload as a JSON array:

```json
"assertions": [
  {
    "type": "url_contains",
    "value": "/dashboard"
  },
  {
    "type": "element_visible",
    "target": { "testId": "submit-btn" }
  }
]
```

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
