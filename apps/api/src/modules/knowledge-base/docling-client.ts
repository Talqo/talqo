import { z } from "zod"

const MAX_RESPONSE_BYTES = 20_000_000
const MAX_CHUNKS = 20_000
const CHUNK_TOKENS = 256
const REQUEST_TIMEOUT_MS = 30_000
const OVERALL_TIMEOUT_MS = 3_600_000
const POLL_INTERVAL_MS = 2000
const responseSchema = z.object({ chunks: z.array(z.object({ text: z.string() })).max(MAX_CHUNKS) })
const submitSchema = z.object({ task_id: z.string() })
const pollSchema = z.object({ task_status: z.string() })
type FetchDocling = (url: URL, init: RequestInit) => Promise<Response>

async function submitFile(name: string, data: Uint8Array, baseUrl: string, fetcher: FetchDocling): Promise<string> {
	const form = new FormData()
	form.append("files", new File([new Uint8Array(data)], name, { type: "application/octet-stream" }))
	form.append("chunking_max_tokens", String(CHUNK_TOKENS))
	const submit = await fetcher(new URL("/v1/chunk/hybrid/file/async", baseUrl), {
		method: "POST",
		body: form,
		signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
	})
	if (!submit.ok) throw new Error(`Docling Serve rejected the file (${submit.status})`)
	return submitSchema.parse(await submit.json()).task_id
}

async function pollTask(taskId: string, baseUrl: string, fetcher: FetchDocling): Promise<void> {
	const deadline = Date.now() + OVERALL_TIMEOUT_MS
	// Poll in order; each status decides the next step.
	while (true) {
		if (Date.now() > deadline) throw new Error("Docling Serve conversion timed out")
		const poll = await fetcher(new URL(`/v1/status/poll/${taskId}`, baseUrl), {
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
		})
		if (!poll.ok) throw new Error(`Docling Serve lost the task (${poll.status})`)
		const status = pollSchema.parse(await poll.json()).task_status
		if (status === "success") return
		if (status === "failure") throw new Error("Docling Serve failed to convert the file")
		await new Promise((resolve) => {
			setTimeout(resolve, POLL_INTERVAL_MS)
		})
	}
}

async function readChunks(taskId: string, baseUrl: string, fetcher: FetchDocling): Promise<Array<string>> {
	const result = await fetcher(new URL(`/v1/result/${taskId}`, baseUrl), {
		signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
	})
	if (!result.ok) throw new Error(`Docling Serve result fetch failed (${result.status})`)
	const reader = result.body?.getReader() as ReadableStreamDefaultReader<Uint8Array> | undefined
	if (!reader) throw new Error("Docling Serve returned no response")
	const pieces: Array<Uint8Array> = []
	let length = 0
	// Read in order so the cap applies to the accumulated body.
	while (true) {
		const { done, value } = await reader.read()
		if (done) break
		length += value.byteLength
		if (length > MAX_RESPONSE_BYTES) {
			await reader.cancel()
			throw new Error("Docling Serve response is too large")
		}
		pieces.push(value)
	}
	const body: unknown = JSON.parse(new TextDecoder().decode(Buffer.concat(pieces)))
	return responseSchema
		.parse(body)
		.chunks.map(({ text }) => text.trim())
		.filter(Boolean)
}

export async function chunkFile(
	name: string,
	data: Uint8Array,
	baseUrl: string,
	fetcher: FetchDocling = async (url, init) => fetch(url, init),
): Promise<Array<string>> {
	const taskId = await submitFile(name, data, baseUrl, fetcher)
	await pollTask(taskId, baseUrl, fetcher)
	return readChunks(taskId, baseUrl, fetcher)
}
