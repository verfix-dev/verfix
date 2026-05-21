# Verfix Workers

The Node.js Playwright execution engine.

## Role
Workers pull jobs from BullMQ, spin up headless Chromium contexts, and execute deterministic flows or AI-assisted exploration.

## Architecture
- **BullMQ**: Orchestrates job distribution and concurrency control.
- **Playwright**: Drives the actual browser interactions.
- **EventTracker**: Pushes granular chronological events (navigation, DOM changes, actions) back to the execution timeline.
- **Healing Engine**: If `mode=assisted` and a selector fails, the worker interfaces with the LLM to recover the interaction.

## Building
Workers are compiled to plain JavaScript before being bundled into the Docker runtime.
```bash
npx tsc
```
