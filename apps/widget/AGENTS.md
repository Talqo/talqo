# Widget

- Ships `dist/widget.js` + `widget.css` for customer websites; `src/widget.tsx` is the production entry, `index.html`/`src/main.tsx` are the dev harness.
- Owns presentation only; chat state, session lifecycle, and recovery live in `@talqo/sdk`. Never import API app source.
- Preview contract with the dashboard: versioned, source- and origin-checked `postMessage` (wire protocol owned by `@talqo/shared/preview-channel`). CDN-only deployments use a sandboxed `srcdoc` frame instead of `preview.html`. `apps/web` never imports widget source.
- Host-page CSS isolation: Tailwind utilities carry the `tw:` prefix; the build scopes everything else under `.talqo-widget` and fails on leftovers (`@keyframes` pass through globally). Dev-mode CSS is unscoped.
- Domain-neutral reused presentation belongs in `packages/ui`.
