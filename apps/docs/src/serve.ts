import { existsSync } from "node:fs"
import { join } from "node:path"

const DEFAULT_DOCS_PORT = 3002
const MAX_PORT = 65_535
const HOSTNAME = "0.0.0.0"
const IMMUTABLE_CACHE = "public, max-age=31536000, immutable"
const DIST_DIR = join(import.meta.dir, "..", "dist")
const SERVER_ENTRY = join(DIST_DIR, "server", "server.js")
const ASSETS_DIR = join(DIST_DIR, "client", "assets")

if (!existsSync(SERVER_ENTRY)) {
	throw new Error(`missing ${SERVER_ENTRY}; run \`bun run build\` first`)
}

function resolvePort(): number {
	const raw = (process.env.TALQO_DOCS_PORT ?? String(DEFAULT_DOCS_PORT)).trim()
	const port = /^\d+$/.test(raw) ? Number(raw) : undefined
	if (port === undefined || port < 1 || port > MAX_PORT) {
		throw new Error(`TALQO_DOCS_PORT must be an integer between 1 and ${MAX_PORT}, got ${JSON.stringify(raw)}`)
	}
	return port
}

// Computed specifier on purpose: the server bundle is a build artifact, not a module TypeScript resolves.
const { default: render } = (await import(SERVER_ENTRY)) as {
	default: { fetch: (request: Request) => Response | Promise<Response> }
}

// Client assets are content-hashed, so they carry an immutable cache policy.
// Anything else is server-rendered by TanStack Start.
async function assetResponse(pathname: string): Promise<Response | null> {
	if (!pathname.startsWith("/assets/")) {
		return null
	}
	const parts = pathname.slice("/assets/".length).split("/")
	if (!parts.every((part) => part !== "" && part !== "." && part !== ".." && !part.includes("\0"))) {
		return new Response("Not Found", { status: 404 })
	}
	const file = Bun.file(join(ASSETS_DIR, ...parts))
	if (!(await file.exists())) {
		return new Response("Not Found", { status: 404 })
	}
	return new Response(file, { headers: { "Cache-Control": IMMUTABLE_CACHE } })
}

const server = Bun.serve({
	fetch: (request) => {
		if (request.method === "GET" || request.method === "HEAD") {
			return assetResponse(new URL(request.url).pathname).then((asset) => asset ?? render.fetch(request))
		}
		return render.fetch(request)
	},
	hostname: HOSTNAME,
	port: resolvePort(),
})

console.log(`Docs listening on http://${HOSTNAME}:${server.port}`)
