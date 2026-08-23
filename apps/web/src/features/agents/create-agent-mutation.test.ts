import { describe, expect, test } from "bun:test"

import { buildNameCandidates, createAgentWithNameFallback } from "./create-agent-mutation"

const CONFLICT_STATUS = 409
const INTERNAL_ERROR_STATUS = 500

// Mirrors the Orval fetch error shape: a plain Error carrying a status.
function failingWith(status: number): Promise<never> {
	const error = new Error("request failed") as Error & { status: number }
	error.status = status
	throw error
}

describe("buildNameCandidates", () => {
	test("starts with the base name", () => {
		expect(buildNameCandidates("New agent")[0]).toBe("New agent")
	})

	test("then appends incrementing suffixes", () => {
		expect(buildNameCandidates("New agent").slice(0, 4)).toEqual([
			"New agent",
			"New agent 2",
			"New agent 3",
			"New agent 4",
		])
	})
})

describe("createAgentWithNameFallback", () => {
	const input = { systemPrompt: "prompt", wordBlacklist: [] }

	test("creates with the base name when it is free", async () => {
		const used: string[] = []
		const create = async ({ name }: { name: string }) => {
			used.push(name)
			return { name }
		}

		const agent = await createAgentWithNameFallback(create, input, ["New agent", "New agent 2"])

		expect(agent.name).toBe("New agent")
		expect(used).toEqual(["New agent"])
	})

	test("retries with the next candidate on a 409 conflict", async () => {
		const used: string[] = []
		const create = async ({ name }: { name: string }) => {
			used.push(name)
			if (used.length < 3) return failingWith(CONFLICT_STATUS)
			return { name }
		}

		const agent = await createAgentWithNameFallback(create, input, ["New agent", "New agent 2", "New agent 3"])

		expect(agent.name).toBe("New agent 3")
	})

	test("does not retry on non-conflict errors", async () => {
		let attempts = 0
		const create = async (): Promise<never> => {
			attempts += 1
			return failingWith(INTERNAL_ERROR_STATUS)
		}

		await expect(createAgentWithNameFallback(create, input, ["A", "A 2"])).rejects.toMatchObject({
			status: INTERNAL_ERROR_STATUS,
		})
		expect(attempts).toBe(1)
	})

	test("rethrows the conflict when every candidate is taken", async () => {
		await expect(
			createAgentWithNameFallback(() => failingWith(CONFLICT_STATUS), input, ["A", "A 2"]),
		).rejects.toMatchObject({ status: CONFLICT_STATUS })
	})
})
