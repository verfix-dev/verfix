# Examples

## Strict Mode JSON Payload

```json
{
  "url": "https://dashboard.example.com",
  "mode": "strict",
  "task": "Verify sidebar navigation",
  "flows": [
    {
      "name": "Click settings",
      "steps": [
        { "action": "click", "target": { "testId": "nav-settings" } }
      ]
    }
  ],
  "assertions": [
    { "type": "url_contains", "value": "/settings" }
  ]
}
```

## Exploratory Mode Payload

```json
{
  "url": "https://dashboard.example.com",
  "mode": "exploratory",
  "task": "Find the billing page, upgrade to the Pro plan, and verify the success toast appears."
}
```
