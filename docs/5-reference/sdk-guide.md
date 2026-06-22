# SDK Guide

The Verfix Node.js SDK allows programmatic interaction with the execution runtime.

## Installation

```bash
npm install verfix
```

## Basic Usage

```typescript
import { VerfixClient } from 'verfix';

// Automatically connects to http://localhost:3611
const client = new VerfixClient();

async function run() {
  const result = await client.verify({
    url: 'https://example.com',
    mode: 'strict',
    task: 'Check header',
    assertions: [
      { type: 'text_exists', value: 'Example Domain' }
    ]
  });

  console.log(`Execution passed: ${result.passed}`);
}

run();
```
