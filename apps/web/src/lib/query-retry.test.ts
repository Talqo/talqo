import { describe, expect, test } from "bun:test"

import { retryUnlessClientError } from "./query-retry"

describe("retryUnlessClientError", () => {
	test("does not retry client errors, including the status range boundaries", () => {
		for (const status of [400, 499]) {
			expect(retryUnlessClientError(0, { status })).toBe(false)
		}
	})

	test("retries other failures at counts zero and two, then stops at three", () => {
		for (const error of [{ status: 399 }, { status: 500 }, {}]) {
			expect(retryUnlessClientError(0, error)).toBe(true)
			expect(retryUnlessClientError(2, error)).toBe(true)
			expect(retryUnlessClientError(3, error)).toBe(false)
		}
	})
})
