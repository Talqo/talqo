---
paths:
  - "**/*.contract.ts"
  - "**/*.routes.ts"
  - "**/*.service.ts"
  - "**/*schema*.ts"
---

# Input Size Limits

Bound every untrusted value the server accepts; an open string, array, object, or body is a DoS vector.

- Cap every `z.string()` with `.max(...)`, every `z.array(...)` with `.max(...)`, and every `z.record(...)` on value length and entry count; never leave one open.
- Keep one global HTTP body-size limit; never disable it per-route.
- Cap anything fed to a memory-hard hash (passwords, tokens, API keys) before the hash; measure secrets as UTF-8 bytes, not `string.length`.
- Share limit constants between contract and service; reject at the boundary, never silently truncate.
