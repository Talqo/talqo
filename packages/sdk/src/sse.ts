import { createParser } from "eventsource-parser"

export class SseParseError extends Error {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options)
		this.name = "SseParseError"
	}
}

export type SseEventParser<T> = (value: unknown, eventName: string | undefined) => T | undefined

const MAX_EVENT_BUFFER_SIZE = 1_048_576

export async function* parseSseStream<T>(
	source: AsyncIterable<Uint8Array>,
	parseEvent: SseEventParser<T>,
): AsyncGenerator<T> {
	const decoder = new TextDecoder()
	const events: T[] = []
	const parser = createParser({
		maxBufferSize: MAX_EVENT_BUFFER_SIZE,
		onError(error) {
			if (error.type === "max-buffer-size-exceeded") {
				throw new SseParseError("SSE event exceeded the parser buffer limit", { cause: error })
			}
		},
		onEvent(event) {
			let value: unknown
			try {
				value = JSON.parse(event.data) as unknown
			} catch (cause) {
				throw new SseParseError("SSE event data is not valid JSON", { cause })
			}
			const parsed = parseEvent(value, event.event)
			if (parsed === undefined) throw new SseParseError("SSE event failed validation")
			events.push(parsed)
		},
	})

	for await (const chunk of source) {
		parser.feed(decoder.decode(chunk, { stream: true }))
		while (events.length > 0) yield events.shift() as T
	}
	const finalText = decoder.decode()
	if (finalText.length > 0) {
		parser.feed(finalText)
		while (events.length > 0) yield events.shift() as T
	}
}
