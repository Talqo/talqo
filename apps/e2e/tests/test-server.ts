import path from "node:path"

type ChatMessage = { content: unknown; role: string }
type CompletionRequest = { messages?: unknown; model?: unknown; stream?: unknown }
type PendingStream = { release(): void }

type ProviderState = {
	requests: { messages: ChatMessage[]; model: string }[]
	pendingStreams: PendingStream[]
}
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

function waitForRelease(signal: AbortSignal, pendingStreams: PendingStream[]): Promise<"aborted" | "released"> {
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
	if (latest === "Where is my order?") return { chunks: ["It ships **tomorrow**."], delayed: false }
	if (latest === "Stream until I cancel") {
		return { chunks: ["Cancellation partial output remains visible"], delayed: true }
	}
	if (latest === "Record this turn") return { chunks: ["Recorded answer."], delayed: false }
	if (latest === "Prove you received the earlier turn") {
		return { chunks: ["Second streamed answer."], delayed: false }
	}
	return { chunks: ["Unexpected fake provider request."], delayed: false }
}

function streamCompletion(request: Request, messages: ChatMessage[], state: ProviderState): Response {
	const requestIndex = state.requests.length
	const id = `chatcmpl-e2e-${requestIndex}`
	const answer = answerFor(messages)
	const body = new ReadableStream<Uint8Array>({
		start(controller) {
			void (async () => {
				try {
					controller.enqueue(event(completionChunk(id, answer.chunks[0] ?? "")))
					if (answer.delayed && (await waitForRelease(request.signal, state.pendingStreams)) === "aborted") {
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

export function createTestServer(): Bun.Server<undefined> {
	const state: ProviderState = { requests: [], pendingStreams: [] }
	return Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		routes: {
			"/": new Response(Bun.file(path.join(import.meta.dirname, "fixtures/host.html"))),
			"/widget.js": new Response(Bun.file(path.resolve(import.meta.dirname, "../../widget/dist/widget.js")), {
				headers: { "content-type": "text/javascript" },
			}),
		},
		async fetch(request) {
			const { pathname } = new URL(request.url)
			if (pathname === "/health") return Response.json({ status: "ok" })
			if (pathname === "/mcp-unavailable") return new Response("MCP unavailable", { status: 503 })
			if (pathname === "/v1/chunk/hybrid/file/async" && request.method === "POST") {
				return Response.json({ task_id: "reader-guide" })
			}
			if (pathname === "/v1/status/poll/reader-guide") return Response.json({ task_status: "success" })
			if (pathname === "/v1/result/reader-guide") return Response.json({ chunks: [{ text: "Reader guide" }] })
			if (pathname === "/v1/embeddings" && request.method === "POST") {
				const body: unknown = await request.json()
				if (
					!body ||
					typeof body !== "object" ||
					!("input" in body) ||
					!Array.isArray(body.input) ||
					!body.input.every((input: unknown) => typeof input === "string") ||
					!("model" in body) ||
					(body.model !== "embedding-model" && body.model !== "embedding-model-next")
				) {
					return Response.json({ error: "Expected an embedding model request with text inputs" }, { status: 400 })
				}
				return Response.json({
					object: "list",
					model: body.model,
					data: body.input.map((_, index) => ({ object: "embedding", index, embedding: [1, 0, 0] })),
					usage: { prompt_tokens: 1, total_tokens: 1 },
				})
			}
			if (pathname === "/v1/models") {
				return Response.json({
					data: [
						{ id: "chat-model" },
						{ id: "chat-model-next" },
						{ id: "embedding-model" },
						{ id: "embedding-model-next" },
					],
				})
			}
			if (pathname === "/control/requests" && request.method === "GET")
				return Response.json({ requests: state.requests })
			if (pathname === "/control/reset" && request.method === "POST") {
				for (const pending of state.pendingStreams.splice(0)) pending.release()
				state.requests.length = 0
				return new Response(null, { status: 204 })
			}
			if (pathname === "/control/release" && request.method === "POST") {
				const pending = state.pendingStreams.shift()
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
				state.requests.push({ model: completion.model, messages })
				return streamCompletion(request, messages, state)
			}
			return new Response("Not found", { status: 404 })
		},
	})
}
