import { app } from "./app.ts"
import { parseEnv } from "./config/env.ts"
import { createStaticResponder, resolveStaticDirs } from "./http/static.ts"
import { runIngestion } from "./modules/knowledge-base/knowledge-base.service.ts"

// Misconfiguration must fail the process at boot, not during the first request.
const config = parseEnv(process.env)
// Static files bypass the API app entirely so its routes stay API-only.
const serveStatic = createStaticResponder(resolveStaticDirs())
const WORKER_RESTART_DELAY_MS = 3_000

const server = Bun.serve({
	fetch(request, bunServer) {
		const peerAddress = bunServer.requestIP(request)?.address
		if (request.method === "GET" || request.method === "HEAD") {
			return serveStatic(request).then((response) => response ?? app.fetch(request, { peerAddress }))
		}
		return app.fetch(request, { peerAddress })
	},
	hostname: "0.0.0.0",
	port: config.TALQO_API_PORT,
})

console.log(`API listening on http://localhost:${server.port}`)
void (async () => {
	/* eslint-disable no-await-in-loop -- only one worker may run per process */
	for (;;) {
		try {
			await runIngestion()
		} catch (error) {
			console.error("agent-file.worker.stopped", { error })
		}
		await Bun.sleep(WORKER_RESTART_DELAY_MS)
	}
	/* eslint-enable no-await-in-loop */
})()
