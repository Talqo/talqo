const port = Number(process.env.E2E_PROVIDER_PORT)
if (!Number.isInteger(port)) throw new Error("E2E_PROVIDER_PORT is required")

type ChatMessage = { content: unknown; role: string }
type CompletionRequest = { messages?: unknown; model?: unknown; stream?: unknown }
type PendingStream = { release(): void }

const EXPECTED_HISTORY_MESSAGE_COUNT = 4
const requests: { messages: ChatMessage[]; model: string }[] = []
const pendingStreams: PendingStream[] = []
const encoder = new TextEncoder()

function isChatMessage(value: unknown): value is ChatMessage {
	return (
		typeof value === "object" &&
		value !== null &&
		"role" in value &&
		typeof value.role === "string" &&
		"content" in value
	)
}

function text(message: ChatMessage | undefined): string {
	return typeof message?.content === "string" ? message.content : ""
}

function event(data: unknown): Uint8Array {
	return encoder.encode(`data: ${JSON.stringify(data)}\n\n`)
}

function completionChunk(id: string, content: string, finishReason: string | null = null) {
	return {
		id,
		object: "chat.completion.chunk",
		created: 1_789_200_000,
		model: "chat-model",
		choices: [{ index: 0, delta: content ? { content } : {}, finish_reason: finishReason }],
	}
}

function waitForRelease(signal: AbortSignal): Promise<"aborted" | "released"> {
	return new Promise((resolve) => {
		let settled = false
		const pending: PendingStream = {
			release() {
				if (settled) return
				settled = true
				signal.removeEventListener("abort", abort)
				resolve("released")
			},
		}
		const abort = () => {
			if (settled) return
			settled = true
			const index = pendingStreams.indexOf(pending)
			if (index >= 0) pendingStreams.splice(index, 1)
			resolve("aborted")
		}
		pendingStreams.push(pending)
		if (signal.aborted) abort()
		else signal.addEventListener("abort", abort, { once: true })
	})
}

function answerFor(messages: ChatMessage[]): { chunks: string[]; delayed: boolean } {
	const latest = text(messages.at(-1))
	if (latest === "Give me the first answer") return { chunks: ["First streame", "d answer", "."], delayed: true }
	if (latest === "Stream until I cancel") {
		return { chunks: ["Cancellation partial output remains visible"], delayed: true }
	}
	if (latest === "Prove you received the earlier turn") {
		const historyIsComplete =
			messages.length === EXPECTED_HISTORY_MESSAGE_COUNT &&
			messages[0]?.role === "system" &&
			text(messages[0]).includes("support assistant") &&
			messages[1]?.role === "user" &&
			text(messages[1]) === "Give me the first answer" &&
			messages[2]?.role === "assistant" &&
			text(messages[2]) === "First streamed answer." &&
			messages[3]?.role === "user"
		return historyIsComplete
			? { chunks: ["History verified: system prompt, ", "first question, and first answer."], delayed: false }
			: { chunks: ["History missing."], delayed: false }
	}
	return { chunks: ["Unexpected fake provider request."], delayed: false }
}

function streamCompletion(request: Request, messages: ChatMessage[], requestIndex: number): Response {
	const id = `chatcmpl-e2e-${requestIndex}`
	const answer = answerFor(messages)
	const body = new ReadableStream<Uint8Array>({
		start(controller) {
			void (async () => {
				try {
					controller.enqueue(event(completionChunk(id, answer.chunks[0] ?? "")))
					if (answer.delayed && (await waitForRelease(request.signal)) === "aborted") {
						controller.error(request.signal.reason ?? new Error("Provider request cancelled"))
						return
					}
					for (const chunk of answer.chunks.slice(1)) controller.enqueue(event(completionChunk(id, chunk)))
					controller.enqueue(event(completionChunk(id, "", "stop")))
					controller.enqueue(
						event({
							id,
							object: "chat.completion.chunk",
							created: 1_789_200_000,
							model: "chat-model",
							choices: [],
							usage: { prompt_tokens: 12, completion_tokens: 6, total_tokens: 18 },
						}),
					)
					controller.enqueue(encoder.encode("data: [DONE]\n\n"))
					controller.close()
				} catch (error) {
					controller.error(error)
				}
			})()
		},
	})
	return new Response(body, {
		headers: {
			"cache-control": "no-cache",
			"content-type": "text/event-stream; charset=utf-8",
		},
	})
}

Bun.serve({
	hostname: "127.0.0.1",
	port,
	async fetch(request) {
		const { pathname } = new URL(request.url)
		if (pathname === "/health") return Response.json({ status: "ok" })
		if (pathname === "/v1/models") {
			return Response.json({ data: [{ id: "chat-model" }, { id: "embedding-model" }] })
		}
		if (pathname === "/control/requests" && request.method === "GET") return Response.json({ requests })
		if (pathname === "/control/reset" && request.method === "POST") {
			for (const pending of pendingStreams.splice(0)) pending.release()
			requests.length = 0
			return new Response(null, { status: 204 })
		}
		if (pathname === "/control/release" && request.method === "POST") {
			const pending = pendingStreams.shift()
			if (!pending) return Response.json({ error: "No provider stream is waiting" }, { status: 409 })
			pending.release()
			return new Response(null, { status: 204 })
		}
		if (pathname === "/v1/chat/completions" && request.method === "POST") {
			const body: unknown = await request.json()
			if (!body || typeof body !== "object") return Response.json({ error: "Invalid request" }, { status: 400 })
			const completion = body as CompletionRequest
			if (
				completion.model !== "chat-model" ||
				completion.stream !== true ||
				!Array.isArray(completion.messages) ||
				!completion.messages.every(isChatMessage)
			) {
				return Response.json({ error: "Expected a streaming chat-model request with messages" }, { status: 400 })
			}
			const messages = structuredClone(completion.messages)
			requests.push({ model: completion.model, messages })
			return streamCompletion(request, messages, requests.length)
		}
		return new Response("Not found", { status: 404 })
	},
})
