# SDK

- Framework-independent browser chat SDK shared by the widget and custom UIs.
- Owns observable chat state, session/bootstrap credentials, storage fallback, stream parsing, cancellation, and recovery; consumers never reimplement these.
- `src/generated` is Orval output covering only `Public Chat` operations; never hand-edit.
- Live turns use an authenticated WebSocket. Page-tool turns can reattach after same-origin navigation in the same tab; other interrupted client calls never resume. HTTP owns configuration, history, recovery, and cancellation without a live connection. There is no SSE transport.
- Browser tools use AI SDK function definitions with local `execute`. Interrupted calls are never replayed. Message `parts` preserve ordered text, steps, and both tool sources.
- `src/page-tool` owns `talqo_page`, its schema, model guidance, on-page approval controls, CSS, and PageController integration. Agent approval instructions arrive through embed configuration. Custom UIs opt in by supplying chat roots through `pageControl.exclude`; the tool excludes those roots and its own controls. Without usable tab storage, ordinary chat remains available without website actions.
- Author styles in CSS files, not TypeScript strings. Import shadow-root styles with `type: "text"`; the widget maps that stylesheet to Vite's `?inline` import when consuming SDK source.
- Bundle `@talqo/page-controller` into the published SDK.
- `pageControl.themeRoot` supplies an element whose `--talqo-*-input` palette colors the page controls. Theme styling does not expose chat content to the tool.
