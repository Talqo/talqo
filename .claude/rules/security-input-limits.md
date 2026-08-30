---
paths:
  - "**/*.contract.ts"
  - "**/*.routes.ts"
  - "**/*.service.ts"
  - "**/*schema*.ts"
---

# Input Size Limits

Every untrusted value the server accepts must have an upper bound. An unbounded string, array, object, or request body is a denial-of-service vector.

## Always Set A Max

- Bound every `z.string()` that takes user input with `.max(...)`; never leave it open.
- Bound every `z.array(...)` with `.max(...)` on element count.
- Bound every `z.record(...)` on value length and entry count.
- Bound numbers with `.max(...)` when a large value wastes work.
- Keep one global HTTP request-body limit; never disable it per-route.

## Secrets And Hashed Inputs

- Cap anything fed to a memory-hard hash (passwords, current passwords, tokens, API keys) before it reaches the hash — reject oversized input instead of hashing it.
- Express password limits as a byte cap, not a char cap: `string.length` counts UTF-16 units, so multi-byte input otherwise sails past argon2/bcrypt's ~72-byte secret limit. Measure with `Buffer.byteLength(value, "utf8")`.

## Rules

- Share limit constants between the zod contract and the service layer instead of duplicating literals.
- Reject at the boundary with a clear error; do not silently truncate.
- Unbounded is acceptable only for values the server itself generates or that are provably fixed-size.
