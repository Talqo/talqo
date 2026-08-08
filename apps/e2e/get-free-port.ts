import { createServer } from "node:net"

// Playwright launches a static config process before any webServer, so the
// widget port must be discovered up front: bind 127.0.0.1:0 to get a port the
// OS knows is free, then release it for vite to claim.
export function getFreePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const server = createServer()
		server.once("error", reject)
		server.listen(0, "127.0.0.1", () => {
			const address = server.address()
			server.close(() => {
				if (typeof address !== "object" || !address) {
					reject(new Error("e2e: could not reserve a free port for the widget dev server"))
					return
				}
				resolve(address.port)
			})
		})
	})
}
