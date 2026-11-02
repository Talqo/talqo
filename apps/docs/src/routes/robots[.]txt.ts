import { createFileRoute } from "@tanstack/react-router"
import { getRequestUrl } from "@tanstack/react-start/server"

export const Route = createFileRoute("/robots.txt")({
	server: {
		handlers: {
			GET: () => {
				const origin = getRequestUrl({ xForwardedHost: true }).origin
				const body = `User-agent: *\nAllow: /\n\nSitemap: ${origin}/sitemap.xml\n`
				return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8" } })
			},
		},
	},
})
