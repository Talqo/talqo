import type { ClientToolChannel } from "./conversation.client-tools.ts"

const BUFFER_BYTES = 8_388_608
const RECONNECT_MS = 20_000

export function createPageConnection(input: {
	credential: string
	embedToken: string
	origin: string | undefined
	send(message: string): void
	close(): void
	cancel(): void
}) {
	let sender: ((message: string) => void) | undefined = input.send
	let close = input.close
	let detached: ReturnType<typeof setTimeout> | undefined
	const frames: string[] = []
	let bytes = 0
	let channel: ClientToolChannel | undefined
	let finished = false
	return {
		credential: input.credential,
		embedToken: input.embedToken,
		origin: input.origin,
		cancel: input.cancel,
		setChannel(value: ClientToolChannel) {
			channel = value
		},
		get channel() {
			return channel
		},
		send(message: unknown) {
			const serialized = JSON.stringify(message)
			bytes += Buffer.byteLength(serialized)
			if (bytes > BUFFER_BYTES) {
				channel?.interrupt()
				throw new Error("Page turn buffer exceeded")
			}
			// Tool invocations are never replayed to a replacement document.
			if (!(typeof message === "object" && message !== null && "type" in message && message.type === "tool-call"))
				frames.push(serialized)
			sender?.(serialized)
		},
		detach() {
			if (finished) return
			sender = undefined
			clearTimeout(detached)
			detached = setTimeout(() => channel?.interrupt(), RECONNECT_MS)
		},
		attach(send: (message: string) => void, finish: () => void) {
			if (finished || sender) throw new Error("Page turn is not available for reconnection")
			clearTimeout(detached)
			sender = send
			close = finish
			for (const frame of frames) send(frame)
			channel?.resumePage()
		},
		finish() {
			finished = true
			clearTimeout(detached)
			close()
		},
	}
}
