import { describe, expect, test } from "bun:test"

import { parseSseStream, SseParseError } from "./sse"

type Event = { type: "delta"; text: string }

function eventParser(value: unknown, eventName: string | undefined): Event | undefined {
	if (
		eventName === "chat" &&
		typeof value === "object" &&
		value !== null &&
		"type" in value &&
		value.type === "delta" &&
		"text" in value &&
		typeof value.text === "string"
	) {
		return { type: "delta", text: value.text }
	}
	return undefined
}

async function* chunks(bytes: Uint8Array, boundaries: number[]): AsyncIterable<Uint8Array> {
	let offset = 0
	for (const boundary of boundaries) {
		yield bytes.slice(offset, boundary)
		offset = boundary
	}
	yield bytes.slice(offset)
}

describe("parseSseStream", () => {
	test("decodes multibyte JSON across arbitrary byte and event boundaries", async () => {
		const encoded = new TextEncoder().encode(
			': keepalive\r\nevent: chat\r\ndata: {"type":"delta",\r\ndata: "text":"你好 🌍"}\r\n\r\n',
		)
		const globe = [...encoded].findIndex((byte, index) => byte === 0xf0 && encoded[index + 1] === 0x9f)
		const events = []

		for await (const event of parseSseStream(
			chunks(encoded, [1, 12, globe + 1, globe + 3, encoded.length - 2]),
			eventParser,
		)) {
			events.push(event)
		}

		expect(events).toEqual([{ type: "delta", text: "你好 🌍" }])
	})

	test("dispatches the final event without a trailing blank line", async () => {
		const source = chunks(new TextEncoder().encode('event: chat\ndata: {"type":"delta","text":"done"}'), [7])
		expect(await Array.fromAsync(parseSseStream(source, eventParser))).toEqual([{ type: "delta", text: "done" }])
	})

	test("rejects invalid JSON and events rejected by the injected parser", async () => {
		const invalidJson = chunks(new TextEncoder().encode("event: chat\ndata: nope\n\n"), [])
		await expect(Array.fromAsync(parseSseStream(invalidJson, eventParser))).rejects.toBeInstanceOf(SseParseError)

		const invalidEvent = chunks(new TextEncoder().encode('event: chat\ndata: {"type":"other"}\n\n'), [])
		await expect(Array.fromAsync(parseSseStream(invalidEvent, eventParser))).rejects.toThrow("validation")
	})
})
