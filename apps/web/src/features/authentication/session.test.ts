import { describe, expect, test } from "bun:test"

import { resolveDashboardSession } from "./session"

function failure(status: number): Error & { status: number } {
	return Object.assign(new Error("request failed"), { status })
}

describe("resolveDashboardSession", () => {
	test("keeps a signed-in operator on the dashboard", async () => {
		await expect(resolveDashboardSession(async () => ({ mustChangePassword: false }))).resolves.toBe("ok")
	})

	test("redirects a missing session to login", async () => {
		await expect(resolveDashboardSession(async () => null)).resolves.toBe("login")
	})

	test("redirects only a 401 to login", async () => {
		await expect(
			resolveDashboardSession(async () => {
				throw failure(401)
			}),
		).resolves.toBe("login")
	})

	test("keeps server and network failures retryable instead of signing out", async () => {
		await expect(
			resolveDashboardSession(async () => {
				throw failure(500)
			}),
		).rejects.toMatchObject({ status: 500 })
		await expect(
			resolveDashboardSession(async () => {
				throw new TypeError("Failed to fetch")
			}),
		).rejects.toThrow("Failed to fetch")
	})

	test("sends an operator with a forced password change to the password form", async () => {
		await expect(resolveDashboardSession(async () => ({ mustChangePassword: true }))).resolves.toBe("passwordChange")
	})
})
