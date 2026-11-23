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

async function* chunks(bytes: Uint8Array, boundaries: Array<number>): AsyncIterable<Uint8Array> {
	let offset = 0
	for (const boundary of boundaries) {
		yield bytes.slice(offset, boundary)
		offset = boundary
	}
	yield bytes.slice(offset)
}

describe("parseSseStream", () => {
	test("ignores comment, unknown, and invalid retry fields", async () => {
		const encoded = new TextEncoder().encode(
			': keepalive\nretry: soon\nfoo: bar\nevent: chat\ndata: {"type":"delta","text":"你好"}\n\n',
		)

		const events = await Array.fromAsync(parseSseStream(chunks(encoded, [3, 19, 40]), eventParser))

		expect(events).toEqual([{ type: "delta", text: "你好" }])
	})

	test("drops a truncated trailing code point without emitting an event", async () => {
		const encoded = new TextEncoder().encode('event: chat\ndata: {"type":"delta","text":"你')
		const truncated = encoded.slice(0, encoded.length - 1)

		expect(await Array.fromAsync(parseSseStream(chunks(truncated, []), eventParser))).toEqual([])
	})

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

	test("rejects an event that exceeds the bounded parser buffer", async () => {
		const oversized = `event: chat\ndata: ${"x".repeat(1_048_576)}`
		const source = chunks(new TextEncoder().encode(oversized), [])

		const error = await Array.fromAsync(parseSseStream(source, eventParser)).catch((cause: unknown) => cause)

		expect(error).toBeInstanceOf(SseParseError)
		expect((error as SseParseError).name).toBe("SseParseError")
		expect((error as SseParseError).message).toContain("buffer limit")
		expect((error as SseParseError).cause).toMatchObject({ type: "max-buffer-size-exceeded" })
	})

	test("rejects invalid JSON and events rejected by the injected parser", async () => {
		const invalidJson = chunks(new TextEncoder().encode("event: chat\ndata: nope\n\n"), [])
		const jsonError = await Array.fromAsync(parseSseStream(invalidJson, eventParser)).catch((cause: unknown) => cause)

		expect(jsonError).toBeInstanceOf(SseParseError)
		expect((jsonError as SseParseError).message).toContain("not valid JSON")
		expect((jsonError as SseParseError).cause).toBeInstanceOf(SyntaxError)

		const invalidEvent = chunks(new TextEncoder().encode('event: chat\ndata: {"type":"other"}\n\n'), [])
		await expect(Array.fromAsync(parseSseStream(invalidEvent, eventParser))).rejects.toThrow("validation")
	})
})
