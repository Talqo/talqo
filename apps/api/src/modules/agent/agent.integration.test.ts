import { sql } from "@/db/client.ts"
import * as identity from "@/modules/identity/identity.service.ts"
import * as roles from "@/modules/roles/roles.service.ts"
import { DEFAULT_PASSWORD, uniqueUsername } from "@/test-helpers.ts"
import { beforeEach, describe, expect, it } from "bun:test"

import * as repo from "./agent.repository.ts"
import * as service from "./agent.service.ts"

async function createOwner(): Promise<string> {
	const user = await identity.createAccount({ username: uniqueUsername(), password: DEFAULT_PASSWORD })
	return user.id
}

beforeEach(async () => {
	await sql`TRUNCATE TABLE blacklist_word, agent CASCADE`
})

describe("agent lifecycle", () => {
	it("creates an agent with defaults and reads it back", async () => {
		const ownerId = await createOwner()

		const created = await service.createAgent({ name: "Docs helper", ownerId })

		expect(created.name).toBe("Docs helper")
		expect(created.status).toBe("active")
		expect(created.systemPrompt).toBe("")
		expect(created.wordBlacklist).toEqual([])
		expect(await service.getAgent(created.id)).toEqual(created)
	})

	it("lists agents in creation order", async () => {
		const ownerId = await createOwner()
		const first = await service.createAgent({ name: "First", ownerId })
		const second = await service.createAgent({ name: "Second", ownerId })

		expect((await service.listAgents()).map((agent) => agent.id)).toEqual([first.id, second.id])
	})

	it("updates only the provided fields", async () => {
		const ownerId = await createOwner()
		const created = await service.createAgent({ name: "Docs helper", ownerId, systemPrompt: "Answer from docs." })

		const updated = await service.updateAgent(created.id, { status: "paused" })

		expect(updated.status).toBe("paused")
		expect(updated.name).toBe("Docs helper")
		expect(updated.systemPrompt).toBe("Answer from docs.")
	})

	it("raises a typed error for an unknown agent", async () => {
		await expect(service.getAgent(crypto.randomUUID())).rejects.toThrow(service.AgentNotFoundError)
		await expect(service.updateAgent(crypto.randomUUID(), { name: "x" })).rejects.toThrow(service.AgentNotFoundError)
		await expect(service.deleteAgent(crypto.randomUUID())).rejects.toThrow(service.AgentNotFoundError)
	})

	it("deletes an agent", async () => {
		const ownerId = await createOwner()
		const created = await service.createAgent({ name: "Temporary", ownerId })

		await service.deleteAgent(created.id)

		expect(await service.listAgents()).toEqual([])
	})

	it("keeps an agent alive when its creator's account is deleted", async () => {
		const ownerId = await createOwner()
		const created = await service.createAgent({ name: "Outlives its owner", ownerId })

		await identity.deleteAccount(ownerId)

		expect((await service.getAgent(created.id)).ownerId).toBeNull()
	})
})

describe("word blacklist", () => {
	it("stores a normalized list on create", async () => {
		const ownerId = await createOwner()

		const created = await service.createAgent({
			name: "Guarded",
			ownerId,
			wordBlacklist: [" spam ", "spam", "abuse", ""],
		})

		expect(created.wordBlacklist).toEqual(["spam", "abuse"])
		expect(await repo.findWords(created.id)).toEqual(["abuse", "spam"])
	})

	it("replaces the whole list rather than appending", async () => {
		const ownerId = await createOwner()
		const created = await service.createAgent({ name: "Guarded", ownerId, wordBlacklist: ["spam", "abuse"] })

		const updated = await service.updateAgent(created.id, { wordBlacklist: ["scam"] })

		expect(updated.wordBlacklist).toEqual(["scam"])
	})

	it("is idempotent when the same list is written twice", async () => {
		const ownerId = await createOwner()
		const created = await service.createAgent({ name: "Guarded", ownerId, wordBlacklist: ["spam"] })

		await service.updateAgent(created.id, { wordBlacklist: ["spam", "spam"] })
		const second = await service.updateAgent(created.id, { wordBlacklist: ["spam"] })

		expect(second.wordBlacklist).toEqual(["spam"])
	})

	it("clears the list when given an empty array", async () => {
		const ownerId = await createOwner()
		const created = await service.createAgent({ name: "Guarded", ownerId, wordBlacklist: ["spam"] })

		expect((await service.updateAgent(created.id, { wordBlacklist: [] })).wordBlacklist).toEqual([])
	})

	it("removes the words along with the agent", async () => {
		const ownerId = await createOwner()
		const created = await service.createAgent({ name: "Guarded", ownerId, wordBlacklist: ["spam"] })

		await service.deleteAgent(created.id)

		expect(await repo.findWords(created.id)).toEqual([])
	})
})

describe("agent-scoped permission grants", () => {
	it("authorizes a member only for the agent named in the grant", async () => {
		const ownerId = await createOwner()
		const memberId = await createOwner()
		const granted = await service.createAgent({ name: "Granted", ownerId })
		const other = await service.createAgent({ name: "Other", ownerId })
		await roles.grantPermission({
			userId: memberId,
			permission: "agents:write",
			agentId: granted.id,
			grantedBy: ownerId,
		})

		expect(await roles.authorize(memberId, "agents:write", granted.id)).toBe(true)
		expect(await roles.authorize(memberId, "agents:write", other.id)).toBe(false)
	})

	it("drops a scoped grant when its agent is deleted", async () => {
		const ownerId = await createOwner()
		const memberId = await createOwner()
		const agent = await service.createAgent({ name: "Doomed", ownerId })
		await roles.grantPermission({
			userId: memberId,
			permission: "agents:write",
			agentId: agent.id,
			grantedBy: ownerId,
		})

		await service.deleteAgent(agent.id)

		const [row] = await sql`SELECT count(*)::int AS count FROM permission_grant WHERE agent_id = ${agent.id}`
		expect(row?.count).toBe(0)
	})
})
