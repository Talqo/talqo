import { describe, expect, it } from "bun:test"

import { chunkFile } from "./docling-client.ts"

describe("Docling Serve chunking", () => {
	it("sends the original file to the hybrid chunker and returns contextualized text", async () => {
		const requests: { url: string; form: FormData }[] = []
		const chunks = await chunkFile(
			"notes.txt",
			new Uint8Array([72, 105]),
			"http://docling.internal:5001",
			async (input, init) => {
				requests.push({ url: String(input), form: init?.body as FormData })
				return Response.json({ chunks: [{ text: "Heading\nHi" }] })
			},
		)
		expect(chunks).toEqual(["Heading\nHi"])
		expect(requests[0]?.url).toBe("http://docling.internal:5001/v1/chunk/hybrid/file")
		expect(requests[0]?.form.get("chunking_max_tokens")).toBe("256")
		const file = requests[0]?.form.get("files")
		expect(file).toBeInstanceOf(File)
		expect((file as File).name).toBe("notes.txt")
	})
})
