import { source } from "@/lib/source"
import { createFileRoute } from "@tanstack/react-router"
import { getRequestUrl } from "@tanstack/react-start/server"

function escapeXml(value: string): string {
	return value.replace(/[<>&'"]/g, (character) => {
		switch (character) {
			case "<":
				return "&lt;"
			case ">":
				return "&gt;"
			case "&":
				return "&amp;"
			case "'":
				return "&apos;"
			default:
				return "&quot;"
		}
	})
}

export const Route = createFileRoute("/sitemap.xml")({
	server: {
		handlers: {
			GET: () => {
				const origin = getRequestUrl({ xForwardedHost: true }).origin
				const paths = new Set(["/", "/problems", ...source.getPages().map((page) => page.url)])
				const urls = [...paths]
					.map((path) => `\t<url><loc>${escapeXml(new URL(path, origin).href)}</loc></url>`)
					.join("\n")

				return new Response(
					`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
					{ headers: { "Content-Type": "application/xml; charset=utf-8" } },
				)
			},
		},
	},
})
