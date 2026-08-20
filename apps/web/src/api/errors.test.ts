import { describe, expect, it } from "bun:test"

import { ApiError, normalizeApiError } from "./errors.ts"

describe("normalizeApiError", () => {
	it("normalizes an Orval fetch error", () => {
		const error = Object.assign(new Error(), {
			status: 403,
			info: { error: "Permission denied" },
		})

		expect(normalizeApiError(error)).toEqual(new ApiError(403, "Permission denied"))
	})

	it("returns null for an unexpected error", () => {
		expect(normalizeApiError(new Error("Network failed"))).toBeNull()
	})
})
