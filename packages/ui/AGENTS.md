# Shared UI

- Keep this package domain-neutral and presentation-only.
- Export components, hooks, and utilities through explicit subpaths; do not add a broad barrel.
- Preserve accessibility and shadcn configuration.
- The design token source of truth is `src/styles/globals.css`: primitive palettes plus semantic tokens for light (`:root`) and dark (`.dark`); add new intents there, not in components.
- Keep `src/lib/utils.ts` limited to the shadcn `cn` helper.
