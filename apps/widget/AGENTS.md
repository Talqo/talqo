# Widget

- Ships two JS files: `dist/widget.js` (launcher, SDK init, loader) and `dist/widget-chat.js` (React chat UI, fetched on first hover, focus, or click). Operators still paste one async script tag. Entries are `src/widget.ts` and `src/chat.tsx`; the dev harness is `index.html`/`src/main.tsx`. Launcher styles live in `src/launcher.css`; chat styles are scoped and inlined by the build.
- Owns presentation only; chat state, session lifecycle, and recovery live in `@talqo/sdk`. Never import API app source.
- Preview contract with the dashboard: versioned, source- and origin-checked `postMessage` (wire protocol owned by `@talqo/shared/preview-channel`). CDN-only deployments use a sandboxed `srcdoc` frame instead of `preview.html`. `apps/web` never imports widget source.
- Host-page CSS isolation: Tailwind utilities carry the `tw:` prefix; the build scopes everything else under `.talqo-widget` and fails on leftovers (`@keyframes` pass through globally). Dev-mode CSS is unscoped and keeps Tailwind preflight while the build strips `@layer base`, so never rely on UA defaults (list markers, margins) — set them explicitly in `.talqo-widget` rules.
- Domain-neutral reused presentation belongs in `packages/ui`.
- Keep this app's locales in `src/locales/<lang>.json` with its own i18next instance; never share locale files with another app. Add a key to every locale file in the same change and keep key sets identical.
