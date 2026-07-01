# Agent Integrations

Verfix acts as the execution infrastructure for AI coding agents.

## Cursor Integration

You can instruct Cursor to use Verfix to verify its own changes.

**Cursor Prompt:**
> "I need you to implement a new login flow. Once you write the code, create a Verfix payload in `verify-login.json` and execute `npx verfix run verify-login.json`. If it fails, read the structured output, fix the code, and try again."

## Claude Code / LangGraph

Agents can interact directly with the Verfix SDK.

```typescript
import { VerfixClient } from 'verfix';

const client = new VerfixClient();

async function verifyAgentChanges() {
  const result = await client.verify({
    url: 'http://localhost:8080',
    mode: 'assisted',
    task: 'Submit the checkout form'
  });
  
  if (!result.passed) {
    // Send result.events and result.error back to the LLM
    await llm.generateFix(result);
  }
}
```

Agents consume structured JSON outputs (assertions, failure classifications) rather than raw DOM dumps, making self-correction deterministic.

## Config-First: don't rewrite source to pass a test

When a selector fails, agents should fix it in **Verfix configuration** (the
`selectors` alias map or assisted-mode self-healing), not by adding `data-testid`
attributes to project source. Verfix enforces this with a source guard that reports
a `source_changes` field on every run and can `block` runs that edit project code.

See **[Config-First Verification](./config-first-verification.md)** for the full
resolution ladder, the `sourceCodePolicy` option, and how the git-baseline guard
works.
