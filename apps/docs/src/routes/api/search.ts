import { search } from "@/lib/search"
import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/api/search")({
	server: {
		handlers: {
			GET: ({ request }) => search.GET(request),
		},
	},
})
