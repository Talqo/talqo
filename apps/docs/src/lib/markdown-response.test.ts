import { beforeEach, describe, expect, mock, test } from "bun:test"

const setResponseHeader = mock()

await mock.module("@tanstack/react-start/server", () => ({ setResponseHeader }))
await mock.module("./source", () => ({
	docsLlms: {
		page: async (page: { data: { title: string } }) => `# ${page.data.title}\n`,
	},
	source: {
		getPage: (slugs: string[]) =>
			slugs.length === 1 && slugs[0] === "deployment" ? { data: { title: "Deployment" } } : undefined,
	},
}))

const { markdownResponse, negotiateMarkdown } = await import("./markdown-response")

describe("markdownResponse", () => {
	test("returns Markdown with a UTF-8 content type", async () => {
		const response = await markdownResponse(["deployment"])

		expect(response?.headers.get("Content-Type")).toBe("text/markdown; charset=utf-8")
		expect(await response?.text()).toBe("# Deployment\n")
	})

	test("returns the problem catalog", async () => {
		const response = await markdownResponse(["problems"])

		expect(await response?.text()).toContain("# API problem types")
	})

	test("returns null for missing or invalid paths", async () => {
		expect(await markdownResponse(["missing"])).toBeNull()
		expect(await markdownResponse([""])).toBeNull()
	})
})

describe("negotiateMarkdown", () => {
	beforeEach(() => setResponseHeader.mockClear())

	test("returns Markdown when the request prefers it", async () => {
		const request = new Request("https://docs.example/deployment", {
			headers: { accept: "text/markdown" },
		})

		const response = await negotiateMarkdown(request, ["deployment"])

		expect(setResponseHeader).toHaveBeenCalledWith("Vary", "Accept")
		expect(response?.headers.get("Content-Type")).toBe("text/markdown; charset=utf-8")
	})

	test("returns null for HTML while still marking the response as varying", async () => {
		const request = new Request("https://docs.example/deployment", {
			headers: { accept: "text/html" },
		})

		expect(await negotiateMarkdown(request, ["deployment"])).toBeNull()
		expect(setResponseHeader).toHaveBeenCalledWith("Vary", "Accept")
	})
})
