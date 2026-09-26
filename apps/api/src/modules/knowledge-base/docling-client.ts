import { z } from "zod"

const MAX_RESPONSE_BYTES = 20_000_000
const MAX_CHUNKS = 20_000
const CHUNK_TOKENS = 256
const TIMEOUT_MS = 300_000
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
	const response = await fetcher(new URL("/v1/chunk/hybrid/file", baseUrl), {
		method: "POST",
		body: form,
		signal: AbortSignal.timeout(TIMEOUT_MS),
	})
	if (!response.ok) throw new Error(`Docling Serve rejected the file (${response.status})`)
	const reader = response.body?.getReader()
	if (!reader) throw new Error("Docling Serve returned no response")
	const pieces: Uint8Array[] = []
	let length = 0
	/* eslint-disable no-await-in-loop -- a response stream must be consumed in order with a byte cap */
	for (;;) {
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
