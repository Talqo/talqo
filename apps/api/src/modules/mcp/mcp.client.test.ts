import { describe, expect, it } from "bun:test"

import { namespaceToolName, truncateResult } from "./mcp.client.ts"

const PROVIDER_TOOL_NAME_MAX_LENGTH = 64

describe("namespaceToolName", () => {
	it("keeps two servers offering the same tool name apart", () => {
		expect(namespaceToolName("Shopify", "get_product")).toBe("Shopify__get_product")
		expect(namespaceToolName("Warehouse", "get_product")).toBe("Warehouse__get_product")
	})

	it("replaces characters a provider tool-name grammar forbids", () => {
		expect(namespaceToolName("my server", "shopify.get/v1")).toBe("my_server__shopify_get_v1")
	})

	it("keeps the whole name within the provider limit, hash included", () => {
		const name = namespaceToolName("s".repeat(40), "t".repeat(40))

		expect(name.length).toBeLessThanOrEqual(PROVIDER_TOOL_NAME_MAX_LENGTH)
		expect(name).toContain("_")
	})

	it("gives two long names that share a prefix distinct keys", () => {
		const first = namespaceToolName("s".repeat(40), `${"t".repeat(40)}a`)
		const second = namespaceToolName("s".repeat(40), `${"t".repeat(40)}b`)

		expect(first).not.toBe(second)
	})
})

describe("truncateResult", () => {
	it("passes small mixed results through untouched", () => {
		const result = {
			content: [
				{ type: "text", text: "ok" },
				{ type: "image", data: "aGVsbG8=", mimeType: "image/png" },
			],
		}
		expect(truncateResult(result)).toEqual(result)
	})

	it("drops a hostile image blob but keeps the small parts", () => {
		const out = truncateResult({
			content: [
				{ type: "text", text: "seen" },
				{ type: "image", data: "x".repeat(20_000), mimeType: "image/png" },
			],
		}) as { content: unknown[] }
		expect(out.content).toHaveLength(2)
		expect(out.content[0]).toEqual({ type: "text", text: "seen" })
		expect(out.content[1]).toEqual({ type: "text", text: "…[truncated, the server returned more]" })
	})

	it("marks truncation once across several over-budget text parts", () => {
		const out = truncateResult({
			content: [
				{ type: "text", text: "a".repeat(9_000) },
				{ type: "text", text: "b".repeat(9_000) },
			],
		}) as {
			content: { text: string }[]
		}
		const markers = out.content.filter((part) => part.text.includes("truncated")).length
		expect(markers).toBe(1)
		expect(JSON.stringify(out).length).toBeLessThan(8_200)
	})
})
