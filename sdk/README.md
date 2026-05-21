# Verfix SDK

The official Node.js SDK for integrating Verfix verification into your AI agents or test pipelines.

## Installation
```bash
npm install verfix
```

## Usage
```typescript
import { VerfixClient } from 'verfix';

const client = new VerfixClient({ baseUrl: 'http://localhost:3001' });

const result = await client.verify({
  url: 'https://example.com',
  task: 'Verify login',
  mode: 'strict',
  assertions: [{ type: 'url_contains', value: 'dashboard' }]
});
```

Agents should consume `result.passed` and `result.events` to understand execution failure contexts.
