import { constants } from "node:os"

import { app } from "./app.ts"
import { parseEnv } from "./config/env.ts"
import { createStaticResponder, resolveStaticDirs } from "./http/static.ts"
import { stdoutWideEventLog } from "./http/wide-event-stdout.ts"
import { migrateLegacyUploadLayout } from "./lib/upload-storage.ts"
import { removeOrphanIcons } from "./modules/embed/embed.service.ts"
import { runIngestion } from "./modules/knowledge-base/knowledge-base.service.ts"

const WORKER_RESTART_DELAY_MS = 3_000
const SIGNAL_EXIT_BASE = 128

export async function runIngestionLoop(): Promise<never> {
	while (true) {
		try {
			await runIngestion()
		} catch (error) {
			console.error("agent-file.worker.stopped", { error })
		}
		await Bun.sleep(WORKER_RESTART_DELAY_MS)
	}
}

if (import.meta.main) {
	// Misconfiguration must fail the process at boot, not during the first request.
	const config = parseEnv(process.env)
	// Before serving, so no request reads a half-moved upload layout.
	await migrateLegacyUploadLayout()
	// Static files bypass the API app entirely so its routes stay API-only.
	const serveStatic = createStaticResponder(resolveStaticDirs())
	const server = Bun.serve({
		fetch(request, bunServer) {
			const peerAddress = bunServer.requestIP(request)?.address
			return serveStatic(request).then((response) => response ?? app.fetch(request, { peerAddress }))
		},
		hostname: "0.0.0.0",
		port: config.TALQO_API_PORT,
	})

	console.log(`API listening on http://localhost:${server.port}`)
	for (const signal of ["SIGINT", "SIGTERM"] as const) {
		process.once(signal, () => {
			try {
				stdoutWideEventLog.flush()
			} finally {
				// 128 + signal number, the shell convention for death by signal. Re-raising is ignored when the API is PID 1.
				process.exit(SIGNAL_EXIT_BASE + constants.signals[signal])
			}
		})
	}
	void removeOrphanIcons().catch((error: unknown) => console.error("embed.icons.sweep_failed", { error }))
	void runIngestionLoop()
}
