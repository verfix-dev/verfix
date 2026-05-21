# Execution Timeline

Verfix discards the concept of standard "video replays." Video is difficult to parse programmatically and slow for humans to scrub through. Instead, Verfix relies on an **Execution Intelligence Timeline**.

## Event-Driven Telemetry

Every execution is decomposed into discrete events:
- `navigation`: Page URL changes.
- `dom_change`: Significant DOM mutations detected.
- `action`: Clicks, typing, scrolling.
- `assertion_passed` / `assertion_failed`: State verification results.
- `retry`: Infrastructure-level or AI-healing retries.
- `ai_reasoning`: The LLM's raw thought process.

## Screenshots Strategy

To optimize performance, screenshots are **not** captured for every successful action.
Screenshots are captured deterministically:
1. **On Failure**: The exact state when an assertion fails.
2. **On Retry**: The state triggering an AI recovery attempt.
3. **On Completion**: A final state snapshot upon successful execution.

This event-centric timeline provides superior observability over simple video recordings, allowing agents and humans to debug failures programmatically.
