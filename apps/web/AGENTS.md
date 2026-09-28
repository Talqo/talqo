# Web

- Use dot routes for shallow branches and directories for layouts, children, or colocated support.
- Keep small route-only support in `-`-prefixed files; put substantial page workflows and shared behavior in one `features/<feature>` owner. Route files own URL/guard/loading concerns and compose the feature UI.
- Use operation-specific query, mutation, and form filenames.
- Keep URL-shareable state in validated search params and ephemeral state local.
- Never edit `routeTree.gen.ts`.
- Move only domain-neutral reused UI to `packages/ui`.
