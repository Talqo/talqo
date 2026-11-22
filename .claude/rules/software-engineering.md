# Engineering defaults

## Clean code

- Choose the smallest readable implementation that meets the requirements. Look for existing code and patterns before adding dependencies, abstractions, or files. Share code that implements the same rule or has the same responsibility.
- Trust documented language and framework guarantees. Use built-in features before writing your own. Add checks and handlers only for failures that can occur and that the caller must handle.
- If you reach for a workaround or lint suppression, check your assumptions, API choice, and design. Fix the cause when possible. Keep exceptions only for verified constraints and limit suppressions to the specific violation.
- Keep functions focused. Use names and structure to explain what the code does. If a comment or docstring gets long, simplify the code first. Document only what the code cannot express, such as a non-obvious invariant, external constraint, or tradeoff.
- Check authoritative sources before choosing or upgrading dependencies. Review compatibility and maintenance status.

## Correctness and safety

- Make the change work through its usual entry points. Preserve required compatibility. Add shims or feature flags only when a supported caller or rollout needs them. Limit cleanup to the affected code.
- Validate untrusted input at boundaries and make failures visible. Add fallbacks only for supported failures. Keep state consistent and prevent duplicate side effects when an operation fails partway, retries, or runs concurrently.
- Grant only the permissions the operation needs. Keep credentials out of source, images, and logs. Limit operational changes to the systems they need to affect and make them reversible.

## Checks and coverage

- Use the `writing-tests` skill when deciding what to test. Run additional checks only to cover a different risk or diagnose a failure.
- Update affected tests, source schemas, docs, and agent instructions when behavior, contracts, or commands change.
