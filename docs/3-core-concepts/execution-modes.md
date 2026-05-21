# Execution Modes

Verfix provides three execution modes, allowing developers to balance deterministic speed with AI-assisted resilience.

## 1. Strict Mode
**Deterministic browser verification.**

- **Behavior**: Executes flows using stable selectors and exact assertions. Fails immediately if a selector is not found.
- **Performance**: Extremely fast. Zero AI invocation overhead.
- **Use Case**: CI/CD, regression testing, production verification.

## 2. Assisted Mode
**Deterministic execution enhanced with semantic healing.**

- **Behavior**: Begins execution identically to Strict Mode. If a strict selector fails, the execution pauses. Verfix captures the current DOM and interfaces with the configured AI model to semantically locate the intended element and heal the flow.
- **Performance**: Fast on success. Incurs LLM latency only upon failure.
- **Use Case**: Flaky selectors, evolving frontends, dynamic UIs where class names mutate.

## 3. Exploratory Mode
**AI-driven flexible browser exploration.**

- **Behavior**: Driven purely by natural language tasks. The agent autonomously navigates and reasons about the application state without strict predefined selectors.
- **Performance**: Heavily bottlenecked by LLM inference speeds.
- **Use Case**: Unknown flows, exploratory QA, bug reproduction, generalized agent tasks.
