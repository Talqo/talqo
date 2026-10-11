import type { WideEvent } from "@/http/wide-event.ts"
import type { EventEmitter } from "node:events"
import type { DestinationStream } from "pino"

import pino from "pino"

const MIN_CLIENT_ERROR_STATUS = 400
const MIN_SERVER_ERROR_STATUS = 500

export type WideEventLog = {
	flush(): void
	write(event: WideEvent): void
}

function levelFor(status: number): "error" | "info" | "warn" {
	if (status >= MIN_SERVER_ERROR_STATUS) return "error"
	if (status >= MIN_CLIENT_ERROR_STATUS) return "warn"
	return "info"
}

export function createWideEventLog(
	destination: DestinationStream & Pick<EventEmitter, "on"> & { flushSync?: () => void },
): WideEventLog {
	const logger = pino(
		{
			base: { "service.name": "talqo-api" },
			formatters: { level: (label) => ({ level: label }) },
			messageKey: "event",
			timestamp: pino.stdTimeFunctions.isoTime,
		},
		destination,
	)
	// The destination drops lines instead of buffering past its cap; the next written line reports how many.
	let dropped = 0
	destination.on("drop", () => {
		dropped += 1
	})

	return {
		write(event) {
			const unreported = dropped
			const fields = unreported ? { ...event, "log.dropped": unreported } : event
			logger[levelFor(event["http.response.status_code"])](fields, "http.request")
			if (dropped === unreported) dropped -= unreported
		},
		flush() {
			destination.flushSync?.()
		},
	}
}
