import { existsSync } from "node:fs"
import { join } from "node:path"

import { createDocsResponder, resolveDocsPort } from "./lib/server"

const HOSTNAME = "0.0.0.0"
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

const server = Bun.serve({
	fetch: createDocsResponder((request) => render.fetch(request), ASSETS_DIR),
	hostname: HOSTNAME,
	port: resolveDocsPort(process.env.TALQO_DOCS_PORT),
})

console.log(`Docs listening on http://${HOSTNAME}:${server.port}`)
