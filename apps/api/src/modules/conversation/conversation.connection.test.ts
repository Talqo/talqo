import { expect, test } from "bun:test"

import { createClientToolChannel } from "./conversation.client-tools.ts"
import { createPageConnection } from "./conversation.connection.ts"

test("buffers only replayable frames and rejects competing owners without interrupting the winner", () => {
	const original: string[] = []
	const resumed: string[] = []
	const sendOriginal = (frame: string) => original.push(frame)
	const sendResumed = (frame: string) => resumed.push(frame)
	let cancellations = 0
	const connection = createPageConnection({
		credential: "credential",
		embedToken: "embed",
		origin: undefined,
		send: sendOriginal,
		close() {},
		cancel() {
			cancellations++
		},
	})
	const channel = createClientToolChannel([{ name: "talqo_page", inputSchema: {} }], () => {}, 400_000)
	connection.setChannel(channel)
	connection.send({ type: "accepted" })
	for (let index = 0; index < 45; index++) connection.send({ type: "tool-call", messages: "x".repeat(200_000) })
	expect(original).toHaveLength(46)
	expect(cancellations).toBe(0)
	connection.detach(sendOriginal)
	expect(connection.attach(sendResumed, () => {})).toBe(true)
	expect(resumed).toEqual([JSON.stringify({ type: "accepted" })])
	expect(
		connection.attach(
			() => {},
			() => {},
		),
	).toBe(false)
	connection.detach(sendOriginal)
	expect(
		connection.attach(
			() => {},
			() => {},
		),
	).toBe(false)
	expect(channel.interrupted).toBe(false)
	connection.finish()
})

test("buffer exhaustion cancels safely instead of throwing out of the event emitter", () => {
	let cancellations = 0
	let closes = 0
	const connection = createPageConnection({
		credential: "credential",
		embedToken: "embed",
		origin: undefined,
		send() {},
		close() {
			closes++
		},
		cancel() {
			cancellations++
		},
	})
	const channel = createClientToolChannel([], () => {}, 400_000)
	connection.setChannel(channel)
	expect(() => {
		for (let index = 0; index < 45; index++) connection.send({ type: "delta", text: "x".repeat(200_000) })
	}).not.toThrow()
	expect(channel.interrupted).toBe(true)
	expect(cancellations).toBe(1)
	expect(closes).toBe(1)
})
