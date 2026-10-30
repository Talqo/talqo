import { describe, expect, test } from "bun:test"

import { embedNotFound } from "./load-failure"

function failure(status: number): Error & { status: number } {
	return Object.assign(new Error("request failed"), { status })
}

describe("embedNotFound", () => {
	test("treats a 404 as missing, without a pointless retry", () => {
		expect(embedNotFound(failure(404))).toBe(true)
	})

	test("treats a 5xx as a load failure worth retrying", () => {
		expect(embedNotFound(failure(500))).toBe(false)
	})

	test("treats a network failure as retryable", () => {
		expect(embedNotFound(new TypeError("Failed to fetch"))).toBe(false)
	})
})
