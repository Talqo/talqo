import { join } from "node:path"

const DEFAULT_DOCS_PORT = 3002
const MAX_PORT = 65_535
const IMMUTABLE_CACHE = "public, max-age=31536000, immutable"

export function resolveDocsPort(value: string | undefined): number {
	const raw = (value ?? String(DEFAULT_DOCS_PORT)).trim()
	const port = /^\d+$/.test(raw) ? Number(raw) : undefined
	if (port === undefined || port < 1 || port > MAX_PORT) {
		throw new Error(`TALQO_DOCS_PORT must be an integer between 1 and ${MAX_PORT}, got ${JSON.stringify(raw)}`)
	}
	return port
}

async function assetResponse(pathname: string, assetsDir: string): Promise<Response | null> {
	if (!pathname.startsWith("/assets/")) return null
	const parts = pathname.slice("/assets/".length).split("/")
	if (!parts.every((part) => part !== "" && part !== "." && part !== ".." && !part.includes("\0"))) {
		return new Response("Not Found", { status: 404 })
	}
	const file = Bun.file(join(assetsDir, ...parts))
	if (!(await file.exists())) return new Response("Not Found", { status: 404 })
	return new Response(file, { headers: { "Cache-Control": IMMUTABLE_CACHE } })
}

export function createDocsResponder(
	render: (request: Request) => Response | Promise<Response>,
	assetsDir: string,
): (request: Request) => Promise<Response> {
	return async (request) => {
		if (request.method === "GET" || request.method === "HEAD") {
			const asset = await assetResponse(new URL(request.url).pathname, assetsDir)
			return asset ?? render(request)
		}
		return render(request)
	}
}
