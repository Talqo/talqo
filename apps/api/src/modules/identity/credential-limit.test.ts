import { afterEach, beforeEach, describe, expect, it, setSystemTime } from "bun:test"

import { createCredentialLimiter, CredentialRateLimitError } from "./credential-limit.ts"

const NOW = new Date("2026-10-25T12:00:00Z")

describe("in-memory credential limits", () => {
	beforeEach(() => setSystemTime(NOW))
	afterEach(() => setSystemTime())

	it("limits one username across networks and resets it at the next minute", async () => {
		const limit = createCredentialLimiter()
		let calls = 0
		const operation = async () => {
			calls += 1
		}
		for (let attempt = 0; attempt < 10; attempt += 1) {
			// oxlint-disable-next-line no-await-in-loop -- successive attempts against one account.
			await limit("network-a", "visitor", operation)
		}
		await expect(limit("network-b", "VISITOR", operation)).rejects.toMatchObject({
			problemCode: "auth-rate-limited",
			status: 429,
			headers: { "Retry-After": "60" },
		})
		expect(calls).toBe(10)
		setSystemTime(new Date("2026-10-25T12:00:59.001Z"))
		await expect(limit("network-b", "VISITOR", operation)).rejects.toMatchObject({
			headers: { "Retry-After": "1" },
		})
		setSystemTime(new Date("2026-10-25T12:01:00Z"))
		await limit("network-a", "visitor", operation)
		expect(calls).toBe(11)
	})

	it("limits a network even when it changes usernames", async () => {
		const limit = createCredentialLimiter()
		for (let attempt = 0; attempt < 30; attempt += 1) {
			// oxlint-disable-next-line no-await-in-loop -- exercise successive accounts from one network.
			await limit("network", `visitor-${attempt}`, async () => undefined)
		}
		await expect(limit("network", "new-visitor", async () => undefined)).rejects.toBeInstanceOf(
			CredentialRateLimitError,
		)
		expect(await limit("other-network", "new-visitor", async () => "allowed")).toBe("allowed")
	})

	it("bounds requests with rotating networks and usernames", async () => {
		const limit = createCredentialLimiter()
		for (let attempt = 0; attempt < 300; attempt += 1) {
			// oxlint-disable-next-line no-await-in-loop -- exhaust the process-wide allowance without hitting narrower limits.
			await limit(`network-${attempt}`, `visitor-${attempt}`, async () => undefined)
		}
		await expect(limit("new-network", "new-visitor", async () => undefined)).rejects.toBeInstanceOf(
			CredentialRateLimitError,
		)
		setSystemTime(new Date("2026-10-25T12:01:00Z"))
		expect(await limit("new-network", "new-visitor", async () => "allowed")).toBe("allowed")
	})

	it("caps concurrent work and releases slots after failure", async () => {
		const limit = createCredentialLimiter()
		const release = Promise.withResolvers<void>()
		const pending = Array.from({ length: 4 }, (_, index) =>
			limit("network", `visitor-${index}`, async () => {
				await release.promise
				throw new Error("verification failed")
			}),
		)
		const settled = Promise.allSettled(pending)
		try {
			await expect(limit("network", "extra", async () => "unexpected")).rejects.toMatchObject({
				problemCode: "auth-rate-limited",
				status: 429,
				headers: { "Retry-After": "1" },
			})
		} finally {
			release.resolve()
			await settled
		}
		expect(await limit("network", "extra", async () => "available")).toBe("available")
	})
})
