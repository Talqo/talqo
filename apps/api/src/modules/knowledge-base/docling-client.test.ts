import { describe, expect, it } from "bun:test"

import { chunkFile } from "./docling-client.ts"

describe("Docling Serve chunking", () => {
	it("submits, polls, and returns contextualized text", async () => {
		const requests: { url: string; form?: FormData }[] = []
		const chunks = await chunkFile(
			"notes.txt",
			new Uint8Array([72, 105]),
			"http://docling.internal:5001",
			async (input, init) => {
				const url = String(input)
				requests.push({ url, form: init?.body as FormData | undefined })
				if (url.endsWith("/async")) return Response.json({ task_id: "t1" })
				if (url.includes("/status/poll/")) return Response.json({ task_status: "success" })
				return Response.json({ chunks: [{ text: "Heading\nHi" }] })
			},
		)
		expect(chunks).toEqual(["Heading\nHi"])
		expect(requests[0]?.url).toBe("http://docling.internal:5001/v1/chunk/hybrid/file/async")
		expect(requests[0]?.form?.get("chunking_max_tokens")).toBe("256")
		const file = requests[0]?.form?.get("files")
		expect(file).toBeInstanceOf(File)
		expect((file as File).name).toBe("notes.txt")
		const urls = requests.map(({ url }) => url)
		expect(urls).toContain("http://docling.internal:5001/v1/status/poll/t1")
		expect(urls).toContain("http://docling.internal:5001/v1/result/t1")
	})
})
