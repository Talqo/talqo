# Documentation App

- Never edit `src/routeTree.gen.ts`.
- Adding or moving a page under `content/docs` needs no route change: `src/routes/$.tsx` renders every page by slug, and `baseUrl` in `src/lib/source.ts` decides the public URLs. The site has no path prefix, so `/problems` stays a sibling of the docs pages and must keep outranking the splat.
- `src/serve.ts` is the process entry point and the container command. It serves `dist/client/assets` and forwards everything else to the built Start handler, so the SSR bundle must be built with `noExternal` and the image must ship no `node_modules`.
- `src/serve.integration.test.ts` fetches the built artifact. It is the guard against content pages that render nowhere.
