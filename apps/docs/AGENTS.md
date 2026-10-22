# Documentation App

- Never edit `src/routeTree.gen.ts`.
- Render every content page by slug in `src/routes/$.tsx`; derive public URLs from `baseUrl` in `src/lib/source.ts`.
- Keep `/problems` as a static sibling of the docs pages; static paths must outrank the splat.
- Serve `dist/client/assets` and forward everything else to the built Start handler in `src/serve.ts`, the process entry point and container command. Keep the SSR bundle dependency-free (`noExternal`); the image ships no `node_modules`.

## Content

Public docs are not a manual for the app. The app explains itself; docs carry information it cannot show.

- Use docs for deployment and operation, non-obvious consequences, limits, security, and concepts the UI assumes, such as writing a system prompt or how MCP servers work.
- Do not teach navigation, controls, or step-by-step use. If the UI already makes it obvious, leave it out.
- Document shipped behavior only. Never present planned or partial behavior as current.
- Omit implementation details unless the reader must act on them, such as limits, security boundaries, or transports. Never use internal names or synonyms for the root `AGENTS.md` vocabulary.
- Cover each topic on one page and link to it. Use frontmatter `title` and `description`, short headed sections, and numbered steps only for setup outside the app.
- Use short sentences and concrete outcomes. If the UI or code already answers it, delete it.
