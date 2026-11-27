import { beforeEach, describe, expect, mock, test } from "bun:test"

const setResponseHeader = mock()

await mock.module("@tanstack/react-start/server", () => ({ setResponseHeader }))
await mock.module("./source", () => ({
	docsLlms: {
		page: async (page: { data: { title: string } }) => `# ${page.data.title}\n`,
	},
	source: {
		getPage: (slugs: Array<string>) => {
			if (slugs.length === 0) return { data: { title: "Docs home" } }
			if (slugs.length === 1 && slugs[0] === "deployment") return { data: { title: "Deployment" } }
			return undefined
		},
	},
}))

const { markdownResponse, negotiateMarkdown } = await import("./markdown-response")
const { getMarkdown } = await import("@/routes/{$}[.]md")

describe("markdownResponse", () => {
	test("returns Markdown with a UTF-8 content type", async () => {
		const response = await markdownResponse(["deployment"])

		expect(response?.headers.get("Content-Type")).toBe("text/markdown; charset=utf-8")
		expect(await response?.text()).toBe("# Deployment\n")
	})

	test("returns the problem catalog", async () => {
		const response = await markdownResponse(["problems"])

		expect(response?.headers.get("Content-Type")).toBe("text/markdown; charset=utf-8")
		expect(await response?.text()).toContain("# API problem types")
	})

	test("returns null for missing or invalid paths", async () => {
		expect(await markdownResponse(["missing"])).toBeNull()
		expect(await markdownResponse([""])).toBeNull()
	})
})

describe("explicit Markdown URLs", () => {
	test("decodes the extension and serves an existing page", async () => {
		const response = await getMarkdown({ params: { _splat: "deployment.md" } })
		expect(response.headers.get("Content-Type")).toBe("text/markdown; charset=utf-8")
		expect(await response.text()).toBe("# Deployment\n")
	})

	test.each(["index.md", undefined])("serves the docs home for root Markdown requests", async (splat) => {
		const response = await getMarkdown({ params: { _splat: splat } })
		expect(response.headers.get("Content-Type")).toBe("text/markdown; charset=utf-8")
		expect(await response.text()).toBe("# Docs home\n")
	})

	test("signals not-found for missing pages", async () => {
		await expect(getMarkdown({ params: { _splat: "missing.md" } })).rejects.toMatchObject({ isNotFound: true })
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
