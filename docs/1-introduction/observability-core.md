# Observability

Verfix is built on the premise that **autonomous browser execution requires absolute observability.** When an AI agent fails to verify a flow, humans need immediate, granular context to determine if the failure was a flaky selector, an application regression, or an AI hallucination.

## The Execution Intelligence Timeline

Verfix discards the concept of standard "video replays." Video is difficult to parse programmatically and slow for humans to scrub through.

Instead, Verfix relies on an **Execution Intelligence Timeline**.

### Event-Driven Telemetry
Every execution is decomposed into discrete, chronological events:
- `navigation`
- `dom_change`
- `action`
- `assertion_passed` / `assertion_failed`
- `retry`
- `ai_reasoning`

### Correlated Context
For any given event in the timeline, the runtime correlates:
1. **Network Logs**: HTTP requests that occurred within ±50ms of the event.
2. **Console Logs**: JavaScript errors or warnings emitted during that exact interaction.
3. **DOM Snapshot**: The state of the DOM at the exact moment of failure.

---

## Screenshot Strategy

To optimize performance and minimize storage overhead, Verfix does **not** take a screenshot at every single step in a successful flow. 

Screenshots are captured deterministically:
1. **On Failure**: The exact visual state when an assertion or action fails.
2. **On Retry**: The visual state that triggered an AI-assisted healing attempt.
3. **On Completion**: A final state snapshot upon successful execution.

*Note: If an execution passes seamlessly in Strict mode, the timeline will only contain textual telemetry and the final state screenshot.*

---

## AI Reasoning Visibility

When Verfix enters **Assisted Mode** or **Exploratory Mode**, the LLM's thought process is not hidden in server logs. It is injected directly into the Execution Timeline as `ai_reasoning` events.

Supervising developers can see:
- The exact DOM snippet the AI evaluated.
- The AI's structured reasoning regarding why a selector failed.
- The synthesized fallback selector or action.

---

## Structured Outputs

Observability isn't just for humans. AI agents need observability to self-correct. 

When an execution fails, Verfix returns a structured, machine-readable JSON payload containing the exact failure classification, network context, and a semantic hint regarding the failure. This prevents agents from blindly retrying without understanding the underlying application state.
