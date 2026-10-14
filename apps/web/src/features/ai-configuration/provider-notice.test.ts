import { describe, expect, test } from "bun:test"

import { providerNotice } from "./provider-notice.ts"

describe("providerNotice", () => {
	test("stays hidden while the configuration loads", () => {
		expect(providerNotice({ isError: false, data: undefined })).toBeUndefined()
	})

	test("stays hidden once the provider is configured", () => {
		expect(providerNotice({ isError: false, data: { data: { health: "configured" } } })).toBeUndefined()
	})

	test("asks to finish setup for a missing or unusable provider", () => {
		expect(providerNotice({ isError: false, data: { data: { health: "unconfigured" } } })).toBe("missing")
		expect(providerNotice({ isError: false, data: { data: { health: "unusable" } } })).toBe("missing")
	})

	test("reports a failed check instead of hiding it", () => {
		expect(providerNotice({ isError: true, data: undefined })).toBe("checkFailed")
	})
})
