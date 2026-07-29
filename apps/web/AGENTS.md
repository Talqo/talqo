# Web

- Use dot routes for shallow branches and directories for layouts, children, or colocated support.
- Keep route-only code in `-`-prefixed files; move shared behavior to one `features/<feature>` owner.
- Use operation-specific query, mutation, and form filenames.
- Keep URL-shareable state in validated search params and ephemeral state local.
- Never edit `routeTree.gen.ts`.
- Move only domain-neutral reused UI to `packages/ui`.
