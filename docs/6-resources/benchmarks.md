# Benchmarks

Verfix continuously benchmarks its execution runtime to optimize for **Reliability** and **Healing Rate**.

## Core Metrics

- **Strict Pass Rate**: Percentage of runs passing in strict mode.
- **Healing Rate**: Percentage of runs successfully recovered by AI in Assisted mode.
- **Overhead Latency**: Time introduced by the Verfix queue vs raw Playwright.

## Benchmark Categories

We test Verfix against modern frontend paradigms:
- **Hydration & SPA Loading**: Waiting for framework hydration before interacting.
- **Dynamic Selectors**: Handling mutated class names (e.g., Tailwind).
- **Auth & Stateful Flows**: Multi-step authentications.
- **Modals & Interception**: Dealing with unexpected popups blocking interactions.
- **Shadow DOM**: Executing actions inside encapsulated components.

## Flaky Detection

Verfix tracks historical assertions. If an assertion alternates between `PASS` and `FAIL` across identical codebases, it is flagged as flaky in the Dashboard metrics.
