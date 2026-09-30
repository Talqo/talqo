import { API_PREFIX } from "@/http/require-auth.ts"

const IMMUTABLE_CACHE = "public, max-age=31536000, immutable"
const DOCUMENT_CACHE = "no-cache"
const WIDGET_PATHS = new Set(["/widget.js", "/widget.css", "/preview.html"])

export type StaticDirs = {
	webDist?: string
	widgetDist?: string
}

// Reads raw env so tests can pass explicit values; parseEnv still validates first.
export function resolveStaticDirs(source: Record<string, string | undefined> = process.env): StaticDirs {
	if (source.TALQO_SERVE_STATIC !== "true") {
		return {}
	}
	const webDist = source.TALQO_WEB_DIST
	const widgetDist = source.TALQO_WIDGET_DIST
	return {
		...(webDist ? { webDist } : {}),
		...(widgetDist ? { widgetDist } : {}),
	}
}

function fileResponse(file: string, cache: string | undefined, url: URL): Response {
	const headers: Record<string, string> = {}
	const control = cache === "versioned" ? (url.search ? IMMUTABLE_CACHE : undefined) : cache
	if (control) {
		headers["Cache-Control"] = control
	}
	return new Response(Bun.file(file), { headers })
}

// Lives in the process entry, not the Hono app, so API routes never mix with UI
// files. Served from the same origin, session cookies stay same-site with no CORS.
export function createStaticResponder({
	webDist,
	widgetDist,
}: StaticDirs): (request: Request) => Promise<Response | null> {
	const exact: Record<string, { file: string; cache: string }> = widgetDist
		? {
				"/widget.js": { file: `${widgetDist}/widget.js`, cache: "versioned" },
				"/widget.css": { file: `${widgetDist}/widget.css`, cache: "versioned" },
				"/preview.html": { file: `${widgetDist}/preview.html`, cache: DOCUMENT_CACHE },
			}
		: {}
	const webIndex = webDist ? `${webDist}/index.html` : undefined

	return async function respond(request: Request): Promise<Response | null> {
		if (request.method !== "GET" && request.method !== "HEAD") {
			return null
		}
		const url = new URL(request.url)
		if (WIDGET_PATHS.has(url.pathname)) {
			const hit = exact[url.pathname]
			return hit && (await Bun.file(hit.file).exists()) ? fileResponse(hit.file, hit.cache, url) : null
		}
		if (url.pathname.startsWith("/assets/")) {
			const parts = url.pathname.slice("/assets/".length).split("/")
			if (webDist && parts.every((part) => part && part !== "." && part !== ".." && !part.includes("\0"))) {
				const file = `${webDist}/assets/${parts.join("/")}`
				if (await Bun.file(file).exists()) {
					return fileResponse(file, IMMUTABLE_CACHE, url)
				}
			}
			return null
		}
		if (webIndex && (await Bun.file(webIndex).exists())) {
			if (url.pathname !== "/health" && !url.pathname.startsWith(`${API_PREFIX}/`)) {
				return fileResponse(webIndex, DOCUMENT_CACHE, url)
			}
		}
		return null
	}
}
