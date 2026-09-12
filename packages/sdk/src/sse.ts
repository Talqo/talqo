export class SseParseError extends Error {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options)
		this.name = "SseParseError"
	}
}

export type SseEventParser<T> = (value: unknown, eventName: string | undefined) => T | undefined

const CRLF_WIDTH = 2

export async function* parseSseStream<T>(
	source: AsyncIterable<Uint8Array>,
	parseEvent: SseEventParser<T>,
): AsyncGenerator<T> {
	const decoder = new TextDecoder()
	let buffer = ""
	let eventName: string | undefined
	let dataLines: string[] = []

	function dispatch(): T | undefined {
		if (dataLines.length === 0) {
			eventName = undefined
			return undefined
		}
		const data = dataLines.join("\n")
		dataLines = []
		let value: unknown
		try {
			value = JSON.parse(data)
		} catch (cause) {
			throw new SseParseError("SSE event data is not valid JSON", { cause })
		}
		const parsed = parseEvent(value, eventName)
		eventName = undefined
		if (parsed === undefined) throw new SseParseError("SSE event failed validation")
		return parsed
	}

	function processLine(line: string): T | undefined {
		if (line === "") return dispatch()
		if (line.startsWith(":")) return undefined
		const colon = line.indexOf(":")
		const field = colon === -1 ? line : line.slice(0, colon)
		let value = colon === -1 ? "" : line.slice(colon + 1)
		if (value.startsWith(" ")) value = value.slice(1)
		if (field === "event") eventName = value
		if (field === "data") dataLines.push(value)
		return undefined
	}

	function takeLine(final: boolean): string | undefined {
		for (let index = 0; index < buffer.length; index += 1) {
			const character = buffer[index]
			if (character === "\n") {
				const line = buffer.slice(0, index)
				buffer = buffer.slice(index + 1)
				return line
			}
			if (character === "\r") {
				if (index + 1 === buffer.length && !final) return undefined
				const width = buffer[index + 1] === "\n" ? CRLF_WIDTH : 1
				const line = buffer.slice(0, index)
				buffer = buffer.slice(index + width)
				return line
			}
		}
		if (final && buffer.length > 0) {
			const line = buffer
			buffer = ""
			return line
		}
		return undefined
	}

	for await (const chunk of source) {
		buffer += decoder.decode(chunk, { stream: true })
		for (let line = takeLine(false); line !== undefined; line = takeLine(false)) {
			const event = processLine(line)
			if (event !== undefined) yield event
		}
	}
	buffer += decoder.decode()
	for (let line = takeLine(true); line !== undefined; line = takeLine(true)) {
		const event = processLine(line)
		if (event !== undefined) yield event
	}
	const finalEvent = dispatch()
	if (finalEvent !== undefined) yield finalEvent
}
