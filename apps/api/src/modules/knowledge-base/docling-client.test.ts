import { afterEach, describe, expect, it, setSystemTime } from "bun:test"

import { chunkFile } from "./docling-client.ts"

const BASE_URL = "http://docling.internal:5001"

function chunk(name: string, fetcher: (url: URL, init: RequestInit) => Promise<Response>) {
	return chunkFile(name, new Uint8Array([72, 105]), BASE_URL, fetcher)
}

function successful(statuses: string[], chunks: { text: string }[], resultBody?: ReadableStream<Uint8Array>) {
	let polls = 0
	return async (input: URL) => {
		const url = String(input)
		if (url.endsWith("/async")) return Response.json({ task_id: "t1" })
		if (url.includes("/status/poll/")) return Response.json({ task_status: statuses[polls++] ?? "success" })
		if (resultBody) return new Response(resultBody, { status: 200 })
		return Response.json({ chunks })
	}
}

function successfulWithResult(response: () => Response) {
	return async (input: URL) => {
		const url = String(input)
		if (url.endsWith("/async")) return Response.json({ task_id: "t1" })
		if (url.includes("/status/poll/")) return Response.json({ task_status: "success" })
		return response()
	}
}

describe("Docling Serve chunking", () => {
	afterEach(() => setSystemTime())

	it("submits, polls, and returns contextualized text", async () => {
		const requests: { url: string; form?: FormData }[] = []
		const chunks = await chunkFile("notes.txt", new Uint8Array([72, 105]), BASE_URL, async (input, init) => {
			const url = String(input)
			requests.push({ url, form: init?.body as FormData | undefined })
			if (url.endsWith("/async")) return Response.json({ task_id: "t1" })
			if (url.includes("/status/poll/")) return Response.json({ task_status: "success" })
			return Response.json({ chunks: [{ text: "Heading\nHi" }] })
		})
		expect(chunks).toEqual(["Heading\nHi"])
		expect(requests[0]?.url).toBe("http://docling.internal:5001/v1/chunk/hybrid/file/async")
		expect(requests[0]?.form?.get("chunking_max_tokens")).toBe("256")
		const file = requests[0]?.form?.get("files")
		expect((file as File).name).toBe("notes.txt")
		const urls = requests.map(({ url }) => url)
		expect(urls).toContain("http://docling.internal:5001/v1/status/poll/t1")
		expect(urls).toContain("http://docling.internal:5001/v1/result/t1")
	})

	it("submits crawler pages as HTML without sending a source URL", async () => {
		let submitted: File | undefined
		await chunkFile("website-page-1.html", new Uint8Array([60]), BASE_URL, async (input, init) => {
			const url = String(input)
			if (url.endsWith("/async")) {
				submitted = (init.body as FormData).get("files") as File
				return Response.json({ task_id: "t1" })
			}
			if (url.includes("/status/poll/")) return Response.json({ task_status: "success" })
			return Response.json({ chunks: [{ text: "Page" }] })
		})
		expect(submitted?.name).toBe("website-page-1.html")
		expect(submitted?.type).toStartWith("text/html")
	})

	it("fails when the submit is rejected", async () => {
		await expect(chunk("notes.txt", async () => new Response("nope", { status: 503 }))).rejects.toThrow(
			"Docling Serve rejected the file (503)",
		)
	})

	it("fails when the task is lost", async () => {
		await expect(
			chunk("notes.txt", async (input) =>
				String(input).endsWith("/async") ? Response.json({ task_id: "t1" }) : new Response("gone", { status: 502 }),
			),
		).rejects.toThrow("Docling Serve lost the task (502)")
	})

	it("fails when the conversion reports failure", async () => {
		const requests: string[] = []
		await expect(
			chunk("notes.txt", async (input) => {
				const url = String(input)
				requests.push(url)
				if (url.endsWith("/async")) return Response.json({ task_id: "t1" })
				return Response.json({ task_status: "failure" })
			}),
		).rejects.toThrow("Docling Serve failed to convert the file")
		expect(requests.some((url) => url.includes("/v1/result/"))).toBe(false)
	})

	it("fails when the result cannot be fetched", async () => {
		await expect(
			chunk(
				"notes.txt",
				successfulWithResult(() => new Response("nope", { status: 500 })),
			),
		).rejects.toThrow("Docling Serve result fetch failed (500)")
	})

	it("fails when the result has no body", async () => {
		await expect(
			chunk(
				"notes.txt",
				successfulWithResult(() => new Response(null, { status: 200 })),
			),
		).rejects.toThrow("Docling Serve returned no response")
	})

	it("rejects a result stream beyond the byte cap", async () => {
		const oversized = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(new Uint8Array(20_000_000))
				controller.enqueue(new Uint8Array(1))
				controller.close()
			},
		})

		await expect(chunk("notes.txt", successful([], [], oversized))).rejects.toThrow(
			"Docling Serve response is too large",
		)
	})

	it("times out while waiting for the conversion", async () => {
		await expect(
			chunk("notes.txt", async (input) => {
				if (String(input).endsWith("/async")) return Response.json({ task_id: "t1" })
				setSystemTime(new Date(Date.now() + 3_600_001))
				return Response.json({ task_status: "pending" })
			}),
		).rejects.toThrow("Docling Serve conversion timed out")
	})

	it("trims returned chunks and drops blank ones", async () => {
		await expect(chunk("notes.txt", successful([], [{ text: "  heading  " }, { text: "   " }]))).resolves.toEqual([
			"heading",
		])
	})
})
