import { expect, spyOn, test } from "bun:test"
import { resolve } from "node:path"

import { runIngestionLoop } from "./index.ts"

test("logs a failed ingestion worker and waits before restarting it", async () => {
	const stopped = new Error("stop the test at the restart delay")
	const pause = spyOn(Bun, "sleep").mockRejectedValue(stopped)
	const log = spyOn(console, "error").mockImplementation(() => {})
	try {
		await expect(runIngestionLoop()).rejects.toBe(stopped)
		const error: unknown = expect.any(Error)
		expect(log).toHaveBeenCalledWith("agent-file.worker.stopped", { error })
		expect(pause).toHaveBeenCalledWith(3_000)
	} finally {
		pause.mockRestore()
		log.mockRestore()
	}
})

async function readUntil(stream: ReadableStream<Uint8Array>, matches: (text: string) => boolean): Promise<string> {
	const decoder = new TextDecoder()
	let text = ""
	for await (const chunk of stream.values({ preventCancel: true })) {
		text += decoder.decode(chunk, { stream: true })
		if (matches(text)) return text
	}
	throw new Error(`API process exited before the expected event: ${text}`)
}

test("keeps HTTP available while the ingestion worker restarts, and exits on SIGTERM", async () => {
	const child = Bun.spawn(
		[process.execPath, "--env-file", ".env.example", "--preload", "./no-database.preload.ts", "src/index.ts"],
		{
			cwd: resolve(import.meta.dir, ".."),
			env: { ...process.env, TALQO_API_PORT: "0", TALQO_SERVE_STATIC: "false" },
			stdout: "pipe",
			stderr: "pipe",
			signal: AbortSignal.timeout(10_000),
		},
	)
	try {
		// The database-free preload makes each real worker attempt fail at the database boundary.
		const [stdout] = await Promise.all([
			readUntil(child.stdout, (text) => text.includes("API listening on")),
			readUntil(child.stderr, (text) => text.split("agent-file.worker.stopped").length >= 2),
		])
		const address = /http:\/\/localhost:\d+/.exec(stdout)?.[0]
		if (!address) throw new Error("API did not report its listen address")
		const response = await fetch(`${address}/health`)
		expect(response.status).toBe(200)
		expect(await response.json()).toEqual({ status: "ok" })

		child.kill("SIGTERM")
		expect(await child.exited).toBe(143)
	} finally {
		child.kill("SIGTERM")
		await child.exited
	}
}, 15_000)
