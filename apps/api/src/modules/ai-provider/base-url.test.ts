import { describe, expect, it } from "bun:test"

import { assertHttpBaseUrl } from "./base-url.ts"

describe("assertHttpBaseUrl", () => {
	it("accepts HTTP and HTTPS endpoints", () => {
		expect(assertHttpBaseUrl("https://example.test/v1").toString()).toBe("https://example.test/v1")
		expect(assertHttpBaseUrl("http://localhost:8080").protocol).toBe("http:")
	})

	it("rejects values that are not URLs", () => {
		expect(() => assertHttpBaseUrl("not a url")).toThrow("Provider base URL must be a valid HTTP or HTTPS URL")
	})

	it("rejects protocols that would read local files or scripts", () => {
		expect(() => assertHttpBaseUrl("file:///etc/secrets")).toThrow("Provider base URL must use HTTP or HTTPS")
	})

	it("uses the caller's label in error messages", () => {
		expect(() => assertHttpBaseUrl("ftp://example.test", "Embedding base URL")).toThrow(
			"Embedding base URL must use HTTP or HTTPS",
		)
	})
})
