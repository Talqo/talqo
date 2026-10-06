import { existsSync } from "node:fs"
import { join } from "node:path"

const DEFAULT_DOCS_PORT = 3002
const MAX_PORT = 65_535
const DIST_DIR = join(import.meta.dir, "..", "dist")
const SERVER_ENTRY = join(DIST_DIR, "server", "server.js")
const ASSETS_DIR = join(DIST_DIR, "client", "assets")

if (!existsSync(SERVER_ENTRY)) {
	throw new Error(`missing ${SERVER_ENTRY}; run \`bun run build\` first`)
}

// Number("") is 0 and Number("abc") is NaN, both of which Bun accepts silently
// (0 means a random port). Reject anything that is not an explicit port instead.
function resolvePort(): number {
	const raw = process.env.TALQO_DOCS_PORT ?? String(DEFAULT_DOCS_PORT)
	const port = Number(raw)
	if (!Number.isInteger(port) || port < 1 || port > MAX_PORT) {
		throw new Error(`TALQO_DOCS_PORT must be an integer between 1 and ${MAX_PORT}, got ${JSON.stringify(raw)}`)
	}
	return port
}

// Computed specifier on purpose: the server bundle is a build artifact, not a module TypeScript resolves.
const { default: render } = (await import(SERVER_ENTRY)) as {
	default: { fetch: (request: Request) => Response | Promise<Response> }
}

// Client assets are content-hashed; every other path is server-rendered by TanStack Start.
const server = Bun.serve({
	fetch: (request) => render.fetch(request),
	routes: { "/assets/*": { dir: ASSETS_DIR } },
	hostname: "0.0.0.0",
	port: resolvePort(),
})

console.log(`Docs listening on http://localhost:${server.port}`)
