import { createServer } from "node:net"

export function getFreePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const server = createServer()
		server.once("error", reject)
		server.listen(0, "127.0.0.1", () => {
			const { port } = server.address() as { port: number }
			server.close(() => resolve(port))
		})
	})
}
