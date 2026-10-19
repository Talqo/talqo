import type { WideEvent } from "@/http/wide-event.ts"

import { describe, expect, it } from "bun:test"
import { EventEmitter } from "node:events"

import { createWideEventLog } from "./wide-event-log.ts"

const EVENT: WideEvent = {
	"request.id": "request",
	"http.request.method": "GET",
	"http.route": "/api/agents",
	"http.response.status_code": 200,
	duration_ms: 3,
}

// Mirrors the capped pino destination: a full buffer emits `drop` instead of writing.
function destination() {
	const emitter = new EventEmitter()
	const lines: Record<string, unknown>[] = []
	let full = false
	return {
		lines,
		setFull: (value: boolean) => {
			full = value
		},
		stream: Object.assign(emitter, {
			write(line: string) {
				if (full) emitter.emit("drop", line)
				else lines.push(JSON.parse(line) as Record<string, unknown>)
			},
		}),
	}
}

describe("wide event log", () => {
	it("writes one JSON line with the status-derived level", () => {
		const { lines, stream } = destination()
		const log = createWideEventLog(stream)
		log.write(EVENT)
		log.write({ ...EVENT, "http.response.status_code": 404 })
		log.write({ ...EVENT, "http.response.status_code": 503 })

		expect(lines.map((line) => line["level"])).toEqual(["info", "warn", "error"])
		expect(lines[0]).toMatchObject({ ...EVENT, event: "http.request", "service.name": "talqo-api" })
		expect(String(lines[0]?.["time"])).toMatch(/^\d{4}-\d{2}-\d{2}T/)
	})

	it("reports dropped lines on the next line that is written", () => {
		const { lines, setFull, stream } = destination()
		const log = createWideEventLog(stream)
		setFull(true)
		log.write(EVENT)
		log.write(EVENT)
		setFull(false)
		log.write(EVENT)
		log.write(EVENT)

		expect(lines.map((line) => line["log.dropped"])).toEqual([2, undefined])
	})
})
