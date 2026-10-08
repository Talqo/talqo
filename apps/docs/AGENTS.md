# Documentation App

- Never edit `src/routeTree.gen.ts`.
- Render every content page by slug in `src/routes/$.tsx`; derive public URLs from `baseUrl` in `src/lib/source.ts`.
- Keep `/problems` as a static sibling of the docs pages; static paths must outrank the splat.
- Serve `dist/client/assets` and forward everything else to the built Start handler in `src/serve.ts`, the process entry point and container command. Keep the SSR bundle dependency-free (`noExternal`); the image ships no `node_modules`.
