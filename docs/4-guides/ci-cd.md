# CI/CD Integration

Verfix is designed to run in continuous integration pipelines to verify AI-generated PRs or standard regressions.

## GitHub Actions Example

```yaml
name: Verification
on: [push]

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Start Verfix Runtime
        run: |
          docker run -d --network=host -e VERFIX_HOST_NETWORK=1 ghcr.io/verfix-dev/verfix-server:latest
          sleep 15 # Wait for services
          
      - name: Run Tests
        run: |
          npx verfix run tests/suite.json
```
