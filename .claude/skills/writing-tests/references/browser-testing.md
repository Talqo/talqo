# Browser testing

Use browser tests for important user outcomes and defects that depend on browser behavior or application wiring. Reuse the repository's browser-test setup; do not create another framework, page-object layer, or browser matrix by default.

## Scenarios and assertions

- Favor critical journeys such as authentication, checkout, or saving user data. Include selected failure and recovery paths for distinct browser risks.
- Exercise the assembled application when claiming E2E coverage. If the application API is stubbed, the test verifies browser behavior, not the browser-to-backend integration.
- Assert the task's outcome. A success notification alone does not prove data was saved; verify the saved value after reload when persistence is the contract.
- Do not pin static headings or incidental copy just because they render. Text assertions can verify required content, validation feedback, dynamic data, or accessible names. Exact URLs matter when navigation is itself the contract.
- Keep rule permutations at a smaller scope. Add a browser case only for the additional risk it catches, not because the lower-level suite lacks coverage.

## Locators and waits

Prefer role and label locators that match how users identify controls. Use stable test IDs when semantic locators are insufficient. Avoid CSS classes, positional selectors, and incidental DOM structure.

Use the runner's auto-waiting and retrying assertions for visible, enabled, or completed states. Await actions and assertions. Wait for the relevant condition, not fixed sleeps or generic network idleness. Register response/event waits before the triggering action when needed, and still assert the user-visible outcome.

## Data and isolation

Create minimal valid data for each scenario. Isolate users, records, browser storage, and mutable state so tests can run independently and in parallel. Clean up resources even on failure. Reuse existing fixtures and authentication setup; do not depend on production accounts or secrets embedded in tests.

Use page objects or helpers only when they reduce repeated meaningful interactions. Keep scenario intent and assertions visible rather than hiding them behind a generic workflow wrapper.

## Network and recovery

Keep the integration being tested real. Use controlled external-service responses or browser network interception when the scenario is specifically client-side error handling. State that scope rather than presenting it as full E2E coverage.

Inject specific timeouts, disconnects, or failures deterministically. Verify preserved data, useful error feedback, working recovery controls, and the eventual outcome. Do not introduce arbitrary latency, repeated retries, or combined failures without a concrete risk. Verify server-side idempotency at its boundary; use browser coverage for distinct double-click or event-timing risks.

## Visual, accessibility, and compatibility checks

Use visual snapshots for an intentional visual contract with stable data and reviewed baselines. Reach states through real interactions, not by editing the DOM to make the screenshot pass. Do not regenerate baselines merely to clear failures.

Use automated accessibility scans when relevant, but also verify affected keyboard interactions, focus, labels, and error feedback. Automated scans do not prove the whole workflow is accessible.

Choose browser and viewport coverage from supported environments and known compatibility risks. Do not run every scenario on every configuration by default.

## Debugging and execution

Run the smallest failing scenario first. Use traces, screenshots, browser console errors, and request evidence to distinguish application defects, synchronization errors, and state leakage. Use headed or debug mode when interaction timing needs inspection. Do not replace useful assertions with longer sleeps or hide a flaky test behind retries.

Parallelize isolated tests and shard existing suites when runtime warrants it. Keep CI artifacts sufficient to diagnose failures. Report retry-dependent passes and unverified integrations rather than claiming clean E2E success.
