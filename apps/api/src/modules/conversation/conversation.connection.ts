import type { ClientToolChannel } from "./conversation.client-tools.ts"

const BUFFER_BYTES = 8_388_608
const RECONNECT_MS = 20_000

function isToolCall(message: unknown): boolean {
	return typeof message === "object" && message !== null && "type" in message && message.type === "tool-call"
}

export function createPageConnection(input: {
	credential: string
	embedToken: string
	origin: string | undefined
	send(message: string): void
	close(): void
	cancel(): void
}) {
	let sender: ((message: string) => void) | undefined = (message) => input.send(message)
	let close = () => input.close()
	let closeOwner = () => input.close()
	let detached: ReturnType<typeof setTimeout> | undefined
	const frames: Array<string> = []
	let bytes = 0
	let channel: ClientToolChannel | undefined
	let finished = false
	function finish(): void {
		if (finished) return
		finished = true
		clearTimeout(detached)
		close()
	}
	function buffer(serialized: string): boolean {
		const frameBytes = Buffer.byteLength(serialized)
		if (bytes + frameBytes > BUFFER_BYTES) {
			console.warn("conversation.page-buffer.exceeded", { bufferedBytes: bytes, frameBytes })
			channel?.interrupt()
			input.cancel()
			finish()
			return false
		}
		bytes += frameBytes
		frames.push(serialized)
		return true
	}
	return {
		credential: input.credential,
		embedToken: input.embedToken,
		origin: input.origin,
		cancel: () => input.cancel(),
		setChannel(value: ClientToolChannel) {
			channel = value
		},
		get channel() {
			return channel
		},
		owns(send: (message: string) => void) {
			return sender === send
		},
		send(message: unknown) {
			if (finished) return
			const serialized = JSON.stringify(message)
			// Tool invocations are never replayed to a replacement document.
			if (!isToolCall(message) && !buffer(serialized)) return
			sender?.(serialized)
		},
		detach(owner: (message: string) => void) {
			if (finished || sender !== owner) return
			sender = undefined
			clearTimeout(detached)
			detached = setTimeout(() => channel?.interrupt(), RECONNECT_MS)
		},
		attach(send: (message: string) => void, onFinish: () => void, closeSocket: () => void): boolean {
			if (finished) return false
			// A navigation may not report the old socket's close before the next document resumes.
			if (sender) closeOwner()
			clearTimeout(detached)
			sender = send
			close = onFinish
			closeOwner = closeSocket
			for (const frame of frames) send(frame)
			channel?.resumePage()
			return true
		},
		finish,
	}
}
