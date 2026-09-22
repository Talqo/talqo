# SDK

- Framework-independent browser chat SDK consumed by the widget; workspace-private until an explicit publishing decision.
- Owns observable chat state, session/bootstrap credentials, storage fallback, stream parsing, cancellation, and recovery; consumers never reimplement these.
- `src/generated` is Orval output covering only `Public Chat` operations; never hand-edit.
- Streaming consumes `POST` responses with fetch and parses SSE framing across arbitrary network chunks; browser `EventSource` is outside the public chat boundary.
