# Benchmarks

Verfix continuously benchmarks its execution runtime across various complex browser environments to ensure deterministic reliability and AI-assisted resilience.

## Benchmark Philosophy

Our benchmarks optimize for **Reliability** and **Healing Rate**, not just raw execution speed. While speed is critical, the primary bottleneck in AI-generated software is flaky tests and false negatives. 

## Core Metrics

- **Strict Pass Rate**: The percentage of runs that pass successfully using strict, deterministic selectors without AI intervention.
- **Healing Rate**: The percentage of runs that initially fail in strict mode but are successfully recovered and completed via AI-assisted healing.
- **Exploratory Success Rate**: The percentage of open-ended, natural language tasks successfully completed in Exploratory mode.
- **Overhead Latency**: The additional time introduced by the Verfix queue and orchestration layer compared to raw Playwright execution.

---

## Benchmark Categories

Verfix is tested against a rigorous suite of modern web application paradigms:

### 1. Hydration & SPA Loading
Testing environments where the DOM exists but JavaScript has not yet fully hydrated, requiring intelligent `dom_change` waits.

### 2. Dynamic Selectors
Environments simulating Tailwind CSS or CSS Modules where class names mutate across deployments (`.btn-x8f9a` -> `.btn-z2b1c`), forcing the semantic healing engine to recover based on visual or ARIA contexts.

### 3. Auth & Stateful Flows
Complex multi-step authentications, including OAuth redirects, where execution context must be preserved across origins.

### 4. Shadow DOM & Iframes
Validating the engine's ability to pierce Shadow DOM boundaries and execute actions within isolated iframes.

### 5. Modals & Interception
Handling unpredictable application state, such as promotional modals, GDPR banners, or unexpected tooltips that intercept click events.

---

## Flaky Detection

Verfix includes an internal flaky detection engine that measures the stability of individual assertions across multiple runs. Benchmarks aggressively penalize assertions that alternate between `PASS` and `FAIL` without code changes, driving continuous improvements to our DOM stabilization heuristics.
