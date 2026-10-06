import { describe, expect, it } from "bun:test"

import { namespaceToolName } from "./mcp.client.ts"

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
