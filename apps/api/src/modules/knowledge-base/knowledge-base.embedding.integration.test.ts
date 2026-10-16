import { sql } from "@/db/client.ts"
import * as agent from "@/modules/agent/agent.service.ts"
import * as aiProvider from "@/modules/ai-provider/ai-provider.service.ts"
import { expect, it, spyOn } from "bun:test"

import * as repository from "./knowledge-base.repository.ts"
import { searchKnowledge } from "./knowledge-base.service.ts"

async function createOwner(name: string) {
	return agent.createAgent({
		name: `${name} ${crypto.randomUUID()}`,
		systemPrompt: "Answer",
		wordBlacklist: [],
	})
}

it("retains failed state and refuses to reclaim it without a retry", async () => {
	const claimKey = `test-fail-${crypto.randomUUID()}`
	const owner = await createOwner("Knowledge")
	try {
		await repository.enqueue(owner.id, "guide.md")
		const first = await repository.claim(claimKey)
		expect(first?.name).toBe("guide.md")
		if (!first) throw new Error("Expected an ingestion job")
		await repository.fail(first, "provider-error")
		await repository.reindexChanged(claimKey)
		expect((await repository.statuses(owner.id)).get("guide.md")?.status).toBe("failed")
		expect(await repository.claim(claimKey)).toBeUndefined()
	} finally {
		await agent.deleteAgent(owner.id)
	}
})

it("retries a failed file and stores its vectors atomically", async () => {
	const claimKey = `test-retry-${crypto.randomUUID()}`
	const owner = await createOwner("Knowledge")
	try {
		await repository.enqueue(owner.id, "guide.md")
		const first = await repository.claim(claimKey)
		if (!first) throw new Error("Expected an ingestion job")
		await repository.fail(first, "provider-error")
		await repository.retry(owner.id, "guide.md")
		const retried = await repository.claim(claimKey)
		if (!retried) throw new Error("Expected a retried job")
		await repository.complete(retried, claimKey, [{ text: "First section", embedding: [0.1, 0.2, 0.3] }])
		const chunks = await sql<{ text: string; embedding: string }[]>`
			SELECT c.text, c.embedding::text AS embedding FROM agent_file_chunk c
			JOIN agent_file f ON f.id = c.file_id WHERE f.agent_id = ${owner.id}`
		expect(chunks.map(({ text, embedding }) => ({ text, embedding }))).toEqual([
			{ text: "First section", embedding: "[0.1,0.2,0.3]" },
		])
	} finally {
		await agent.deleteAgent(owner.id)
	}
})

it("requeues files when the embedding model changes and fences the stale completion", async () => {
	const firstKey = `test-model-a-${crypto.randomUUID()}`
	const secondKey = `test-model-b-${crypto.randomUUID()}`
	const owner = await createOwner("Knowledge")
	try {
		await repository.enqueue(owner.id, "guide.md")
		const first = await repository.claim(firstKey)
		if (!first) throw new Error("Expected an ingestion job")
		await repository.complete(first, firstKey, [{ text: "First section", embedding: [0.1, 0.2, 0.3] }])
		await repository.reindexChanged(secondKey)
		expect((await repository.statuses(owner.id)).get("guide.md")?.status).toBe("pending")
		const changed = await repository.claim(secondKey)
		if (!changed) throw new Error("Expected a model-change job")
		await repository.complete(first, firstKey, [{ text: "Stale", embedding: [1, 2, 3] }])
		expect((await repository.statuses(owner.id)).get("guide.md")?.status).toBe("processing")
		await repository.complete(changed, secondKey, [{ text: "New", embedding: [3, 2, 1] }])
		expect((await repository.statuses(owner.id)).get("guide.md")?.status).toBe("ready")
	} finally {
		await agent.deleteAgent(owner.id)
	}
})

it("recovers processing files after a restart and fences the stale worker", async () => {
	const claimKey = `test-recover-${crypto.randomUUID()}`
	const owner = await createOwner("Knowledge")
	try {
		await repository.enqueue(owner.id, "guide.md")
		const interrupted = await repository.claim(claimKey)
		if (!interrupted) throw new Error("Expected a job before restart")
		await repository.recover()
		const recovered = await repository.claim(claimKey)
		if (!recovered) throw new Error("Expected a recovered job")
		await repository.complete(interrupted, claimKey, [{ text: "Old worker", embedding: [9, 9, 9] }])
		expect((await repository.statuses(owner.id)).get("guide.md")?.status).toBe("processing")
		await repository.complete(recovered, claimKey, [{ text: "Recovered", embedding: [4, 5, 6] }])
		expect((await repository.statuses(owner.id)).get("guide.md")?.status).toBe("ready")
	} finally {
		await agent.deleteAgent(owner.id)
	}
})

it("searches ready chunks by similarity within the agent and model key", async () => {
	const owner = await agent.createAgent({
		name: `Search ${crypto.randomUUID()}`,
		systemPrompt: "Answer",
		wordBlacklist: [],
	})
	const other = await agent.createAgent({
		name: `Search ${crypto.randomUUID()}`,
		systemPrompt: "Answer",
		wordBlacklist: [],
	})
	try {
		await repository.enqueue(owner.id, "guide.md")
		const job = await repository.claim("key-a")
		if (!job) throw new Error("Expected an ingestion job")
		await repository.complete(job, "key-a", [
			{ text: "apples", embedding: [1, 0, 0] },
			{ text: "bananas", embedding: [0, 1, 0] },
		])
		await repository.enqueue(other.id, "other.md")
		const otherJob = await repository.claim("key-a")
		if (!otherJob) throw new Error("Expected another ingestion job")
		await repository.complete(otherJob, "key-a", [{ text: "other agent", embedding: [1, 0, 0] }])

		expect(await repository.search(owner.id, [1, 0, 0], "key-a", 5)).toEqual(["apples", "bananas"])
		expect(await repository.search(owner.id, [1, 0, 0], "key-a", 1)).toEqual(["apples"])
		expect(await repository.search(owner.id, [1, 0, 0], "key-b", 5)).toEqual([])
	} finally {
		await agent.deleteAgent(owner.id)
		await agent.deleteAgent(other.id)
	}
})

it("skips the embedding provider when the agent has no ready files", async () => {
	const owner = await agent.createAgent({
		name: `Empty ${crypto.randomUUID()}`,
		systemPrompt: "Answer",
		wordBlacklist: [],
	})
	const prepare = spyOn(aiProvider, "prepareEmbeddingOperation")
	try {
		await repository.enqueue(owner.id, "pending.md")
		expect(await searchKnowledge(owner.id, "question")).toEqual([])
		expect(prepare).not.toHaveBeenCalled()
	} finally {
		prepare.mockRestore()
		await agent.deleteAgent(owner.id)
	}
})
