import { z } from "zod"

const MAX_RESPONSE_BYTES = 20_000_000
const MAX_CHUNKS = 20_000
const CHUNK_TOKENS = 256
const REQUEST_TIMEOUT_MS = 30_000
const OVERALL_TIMEOUT_MS = 3_600_000
const POLL_INTERVAL_MS = 2_000
const responseSchema = z.object({ chunks: z.array(z.object({ text: z.string() })).max(MAX_CHUNKS) })
type FetchDocling = (url: URL, init: RequestInit) => Promise<Response>

export async function chunkFile(
	name: string,
	data: Uint8Array,
	baseUrl: string,
	fetcher: FetchDocling = (url, init) => fetch(url, init),
): Promise<string[]> {
	const form = new FormData()
	form.append("files", new File([new Uint8Array(data)], name, { type: "application/octet-stream" }))
	form.append("chunking_max_tokens", String(CHUNK_TOKENS))
	const submit = await fetcher(new URL("/v1/chunk/hybrid/file/async", baseUrl), {
		method: "POST",
		body: form,
		signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
	})
	if (!submit.ok) throw new Error(`Docling Serve rejected the file (${submit.status})`)
	const { task_id: taskId } = (await submit.json()) as { task_id: string }

	const deadline = Date.now() + OVERALL_TIMEOUT_MS
	/* eslint-disable no-await-in-loop -- task status polling is inherently sequential */
	while (true) {
		if (Date.now() > deadline) throw new Error("Docling Serve conversion timed out")
		const poll = await fetcher(new URL(`/v1/status/poll/${taskId}`, baseUrl), {
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
		})
		if (!poll.ok) throw new Error(`Docling Serve lost the task (${poll.status})`)
		const status = ((await poll.json()) as { task_status: string }).task_status
		if (status === "success") break
		if (status === "failure") throw new Error("Docling Serve failed to convert the file")
		await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
	}
	/* eslint-enable no-await-in-loop */

	const result = await fetcher(new URL(`/v1/result/${taskId}`, baseUrl), {
		signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
	})
	if (!result.ok) throw new Error(`Docling Serve result fetch failed (${result.status})`)
	const reader = result.body?.getReader()
	if (!reader) throw new Error("Docling Serve returned no response")
	const pieces: Uint8Array[] = []
	let length = 0
	/* eslint-disable no-await-in-loop -- a response stream must be consumed in order with a byte cap */
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
	/* eslint-enable no-await-in-loop */
	const bytes = new Uint8Array(length)
	let offset = 0
	for (const piece of pieces) {
		bytes.set(piece, offset)
		offset += piece.byteLength
	}
	const body: unknown = JSON.parse(new TextDecoder().decode(bytes))
	return responseSchema
		.parse(body)
		.chunks.map(({ text }) => text.trim())
		.filter(Boolean)
}
