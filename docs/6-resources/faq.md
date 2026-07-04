# FAQ

## Is Verfix an AI Agent?
No. Verfix is the *execution infrastructure* for AI agents. We provide the observability, retry mechanisms, and structured timelines that allow AI agents to confidently interact with browsers.

## Can I use it without AI?
Yes. `Strict Mode` (the default) relies purely on deterministic selectors and bypasses all LLM interactions, functioning similarly to a highly-observable Playwright runner. It needs no AI key at all.

## Do I need Docker?
No. By default `verfix run` executes entirely in-process on Node.js 20+ and stores results + Playwright traces under `.verfix/runs/`. Docker is only needed for the opt-in server runtime (`--server`), which exists for the future hosted CI product.

## Does it run in the cloud?
Verfix is local-first. You can run the opt-in server runtime on your own infrastructure, but we do not currently host a SaaS platform (a hosted dashboard is planned).
