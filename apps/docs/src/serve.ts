import { existsSync } from "node:fs"
import { join } from "node:path"

const DEFAULT_DOCS_PORT = 3002
const DIST_DIR = join(import.meta.dir, "..", "dist")
const SERVER_ENTRY = join(DIST_DIR, "server", "server.js")
const ASSETS_DIR = join(DIST_DIR, "client", "assets")

if (!existsSync(SERVER_ENTRY)) {
	throw new Error(`missing ${SERVER_ENTRY}; run \`bun run build\` first`)
}

// Computed specifier on purpose: the server bundle is a build artifact, not a module TypeScript resolves.
const { default: render } = (await import(SERVER_ENTRY)) as {
	default: { fetch: (request: Request) => Response | Promise<Response> }
}

// Hashed client assets are immutable; every other path is server-rendered by TanStack Start.
const server = Bun.serve({
	fetch: (request) => render.fetch(request),
	routes: { "/assets/*": { dir: ASSETS_DIR } },
	hostname: "0.0.0.0",
	port: Number(process.env.TALQO_DOCS_PORT ?? DEFAULT_DOCS_PORT),
})

console.log(`Docs listening on http://localhost:${server.port}`)
