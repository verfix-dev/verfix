# 🎬 Execution Intelligence Timeline

> **Developer Observability for Browser Agents** — A summary-first timeline that highlights meaningful state transitions, failures, and retries.

---

## Overview

The Execution Intelligence Timeline turns raw browser automation results into a **signal-driven narrative**. Instead of replaying every micro-action, it elevates only the moments that matter: step failures, retries, and assertion failures. This keeps debugging fast, accurate, and low-noise.

This feature is built on an **Event-Based Architecture** with a **Tiered Capture System**, meaning it is designed to be production-safe by default (fast, low storage) and only escalates to full captures when something goes wrong.

---

## When Does the Replay Tab Appear?

The **Replay** tab appears in the Execution Detail panel **only when the execution has events recorded** (`events.length > 0`).

| Mode | Replay Tab Shown? |
|---|---|
| `strict` (no flows) | ✅ Yes — failure signals |
| `strict` (with flows) | ✅ Yes — retries + failure signals |
| `assisted` | ✅ Yes — retries + failure signals |
| `exploratory` | ✅ Yes — summarized reasoning + signal events |
| `queued` / `running` | ❌ No — replay only shows after completion |

---

## Event Types

The system tracks a compact set of signal events, each with its own color and icon in the timeline:

| Event Type | Color | Icon | When It Fires |
|---|---|---|---|
| `assertion_failed` | Red | ❌ XCircle | After an assertion evaluates to `false` |
| `retry` | Yellow | ⚠️ Triangle | When a flow step or exploration action fails |
| `ai_reasoning` | Purple | 🧠 Brain | Summarized reasoning for exploratory runs |

---

## Screenshot Capture: When & How

This is the most important design decision in the system. Screenshots are **signal-driven** and captured only on meaningful transitions:

✅ step failures / retries
✅ assertion failures

### Tier 1 — Signal Capture (Non-blocking)

**When triggered:**
- On retries and step failures

**What is captured:**
- A compressed viewport screenshot (PNG, CSS scale — not full-page)
- A lightweight DOM snippet of up to 50 interactive elements

**How it works:**
```
page.screenshot() → fires and is NOT awaited
                  → attaches to the event object once complete
                  → NEVER blocks the main execution pipeline
```

**Why:** Blocking the browser to take a full-page screenshot after every single click would add 200-500ms per step and stall real-time execution. Signal-driven snapshots keep the timeline useful and fast.

> ⚠️ **Strict Mode Exception:** In `strict` mode, lightweight async captures are **skipped** by default to maximize CI/CD pipeline speed. Only failure captures are taken.

---

### Tier 2 — Synchronous Failure Capture (Blocking, on demand)

**When triggered:**
- When the entire execution **fails** (`passed === false`) — a final-state screenshot is taken synchronously before the context closes
- When an individual **assertion fails** — a screenshot is taken at the exact moment of failure

**What is captured:**
- Full viewport screenshot (blocking, guaranteed to complete)
- This is attached to the `assertion_failed` event and also saved as `{executionId}_fail_{assertionType}.png`

**Why:** For failures, we *want* to block briefly to guarantee we have the evidence before the browser is closed and context is destroyed.

---

### Tier 3 — Full Artifacts (Final collection)

**When triggered:**
- After every execution completes (pass or fail)

**What is captured:**
- Playwright Trace (`.zip`) — full browser trace with DOM snapshots
- HAR file — all network requests with headers and bodies
- Console log JSON
- Network log JSON

These are accessible from the **Artifacts** tab, not the Replay tab.

---

## The Intelligence Timeline Layout

```
┌──────────────────────────────────────────────────────────────────────┐
│  Tab Bar: [Replay ●] [Assertions] [Console] [Network] [Artifacts]    │
├──────────────────────────────────────────────────────────────────────┤
│                                                                        │
│  ┌─────────────────────┐  ┌─────────────────────────────────────────┐ │
│  │  SIGNAL TIMELINE    │  │  SCREENSHOT / AI REASONING PANEL        │ │
│  │                     │  │                                         │ │
│  │  ● +0ms             │  │  [Screenshot of browser at this step]   │ │
│  │    retry            │  │                                        │ │
│  │    Navigating to…   │  │  OR, for ai_reasoning events:           │ │
│  │    │                │  │                                         │ │
│  │  ● +312ms           │  │    🧠 AI Reasoning                      │ │
│  │    ai_reasoning     │  │    "The page shows a search bar.        │ │
│  │    Page loaded: …   │  │     I will type 'spotify' and press    │ │
│  │    │                │  │     Enter to submit the search."        │ │
│  │  🧠 +1024ms         │  │    [Decided: type → #APjFqb]           │ │
│  │    ai_reasoning     │  │                                         │ │
│  │    "Searching…"  ●  │  │                    [← Prev]  [Next →]  │ │
│  │    │                │  ├─────────────────────────────────────────┤ │
│  │  ⚠ +2100ms         │  │  CONSOLE AT THIS STEP (2)               │ │
│  │    retry            │  │  [error] TypeError: Cannot read…        │ │
│  │                     │  ├─────────────────────────────────────────┤ │
│  │  ❌ +2800ms         │  │  NETWORK AT THIS STEP (5)               │ │
│  │    assertion_failed │  │  200 GET https://api.example.com/…      │ │
│  └─────────────────────┘  └─────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────┘
```

### Left Panel — Signal Timeline
- Scrollable vertical list of **signal events only**
- Each event has a **color-coded icon** (see Event Types table above)
- Events are connected by a subtle vertical line for visual hierarchy
- **Relative timestamp** shown under each event (e.g., `+1024ms`)
- A **small cyan dot** on the right indicates events that have an attached screenshot
- Clicking any event makes it the active event and updates both the main panel and the bottom panels

### Main Panel — Replay Viewer
- Displays the screenshot for the selected event (served from `/artifacts/`)
- If the event has no screenshot (e.g., `ai_reasoning`), shows a contextual text panel instead:
  - `ai_reasoning` → shows the full LLM thought text and its decided action
  - All others → shows a placeholder icon
- **Floating badge** (top-left) shows the event type and position in the sequence (e.g., `#4/12`)
- **Prev / Next buttons** (bottom-right) for keyboard-free navigation through the timeline

### Bottom Panel — Contextual Logs & Network
The bottom panel is **filtered to the time window of the active signal**. It only shows console logs and network requests that occurred between the active event's timestamp and the next event's timestamp.

This is what makes it fundamentally different from the raw Console/Network tabs — instead of seeing 200 requests, you see the 3 that happened during *this specific step*.

---

## Data Flow

```
Browser Action
     │
     ▼
EventTracker.pushEvent(type, message, metadata)
     │
     ├─── Synchronously adds to events[] array (zero latency)
     │
     └─── EventTracker.captureSignalState(page, reason)
               │
               └─── page.screenshot() ← NOT AWAITED (fire & forget)
                         │
                         └─── On complete: event.screenshot = path
```

```
Job Completes
     │
     ├── executionResult.events = tracker.getEvents()
     │
     └── setResult(id, executionResult)  ← saved to Redis
               │
               └── Dashboard polls /api/v1/executions/:id
                         │
                         └── Replay tab appears if events.length > 0
```

---

## Architecture Decisions

### Why event-based instead of step-array-based?

A step array would only capture what we *planned* (flow steps, assertions). Events capture everything that *happened* — including unplanned failures, console errors thrown by third-party scripts, network timeouts from CDNs, and the AI's internal reasoning chain. This makes debugging far more powerful because the unexpected things are exactly what you need to see.

### Why keep console/network logs separate from events?

Merging them into a single array would double the storage size of every execution, since both lists can be very large (hundreds of entries). Instead, they remain as separate arrays and the Replay UI weaves them together chronologically using **timestamp comparison** — giving us full observability without the storage cost.

### Why signal-driven async screenshots?

Playwright's `page.screenshot()` is not instant — it can take 100-400ms on complex pages. By capturing only on meaningful signals and firing without `await`, we avoid slowing every step while still preserving the important evidence.

---

## File Reference

| File | Purpose |
|---|---|
| `workers/src/artifacts/event-tracker.ts` | Core `EventTracker` class — manages events, tiered capture |
| `workers/src/assertions/types.ts` | `ExecutionEvent` and `ExecutionEventType` definitions |
| `workers/src/index.ts` | EventTracker instantiation, console/network error hooks, final attachment |
| `workers/src/browser/flow-executor.ts` | Emits `retry` signals per flow step |
| `workers/src/assertions/engine.ts` | Emits `assertion_failed` signals per check |
| `workers/src/ai/exploration.ts` | Emits summarized `ai_reasoning` + `retry` signals |
| `dashboard/src/app/page.tsx` | `ExecutionEvent` and `ExecutionEventType` types for frontend |
| `dashboard/src/components/ExecutionDetail.tsx` | `ReplayTab` component — the full Replay UI |

---

## Future Roadmap

Live streaming (WebSocket push) and a DOM diff viewer were considered here but
are an explicit non-goal per `ROADMAP.md` ("Real-time streaming, WebSockets,
execution diffing — observability polish for a dashboard nobody uses yet") —
not currently planned.

- [ ] **Event filtering** — Filter the timeline by event type (e.g., show only `ai_reasoning` events)
- [ ] **Scrubbing** — A horizontal progress bar to scrub through the timeline by time percentage
- [ ] **User annotations** — Add thumbs up/down to AI reasoning events for fine-tuning feedback
- [ ] **Strict mode captures** — Optional `CAPTURE_ALL=true` env flag to enable per-step screenshots even in strict mode
