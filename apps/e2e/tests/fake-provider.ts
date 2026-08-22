const port = Number(process.env.E2E_PROVIDER_PORT)
if (!Number.isInteger(port)) throw new Error("E2E_PROVIDER_PORT is required")

Bun.serve({
	hostname: "127.0.0.1",
	port,
	fetch(request) {
		const { pathname } = new URL(request.url)
		if (pathname === "/health") return Response.json({ status: "ok" })
		if (pathname === "/v1/models") {
			return Response.json({ data: [{ id: "chat-model" }, { id: "embedding-model" }] })
		}
		return new Response("Not found", { status: 404 })
	},
})
