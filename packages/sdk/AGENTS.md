# SDK

- Framework-independent browser chat SDK shared by the widget and custom UIs.
- Owns observable chat state, session/bootstrap credentials, storage fallback, stream parsing, cancellation, and recovery; consumers never reimplement these.
- `src/generated` is Orval output covering only `Public Chat` operations; never hand-edit.
- Live turns use one WebSocket each, authenticated in the first application frame. HTTP owns configuration, history, and recovery. Never silently fall back to SSE.
- Browser tools use AI SDK function definitions with local `execute`. Interrupted calls are never replayed. Message `parts` preserve ordered text, steps, and both tool sources.
