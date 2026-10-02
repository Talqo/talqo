import { sql } from "@/db/client.ts"
import * as agent from "@/modules/agent/agent.service.ts"
import { expect, it } from "bun:test"

import * as repository from "./knowledge-base.repository.ts"

it("stores vectors atomically, retains failed state, and requeues when the model changes", async () => {
	const owner = await agent.createAgent({
		name: `Knowledge ${crypto.randomUUID()}`,
		systemPrompt: "Answer",
		wordBlacklist: [],
	})
	try {
		await repository.enqueue(owner.id, "guide.md")
		const first = await repository.claim("openai:model-a")
		expect(first?.name).toBe("guide.md")
		if (!first) throw new Error("Expected an ingestion job")
		await repository.fail(first, "provider-error")
		await repository.reindexChanged("openai:model-a")
		expect((await repository.statuses(owner.id)).get("guide.md")?.status).toBe("failed")
		expect(await repository.claim("openai:model-a")).toBeUndefined()
		await repository.retry(owner.id, "guide.md")
		const retried = await repository.claim("openai:model-a")
		if (!retried) throw new Error("Expected a retried job")
		await repository.complete(retried, "openai:model-a", [{ text: "First section", embedding: [0.1, 0.2, 0.3] }])
		const chunks = await sql<{ text: string; embedding: string }[]>`
			SELECT c.text, c.embedding::text AS embedding FROM agent_file_chunk c
			JOIN agent_file f ON f.id = c.file_id WHERE f.agent_id = ${owner.id}`
		expect(chunks.map(({ text, embedding }) => ({ text, embedding }))).toEqual([
			{ text: "First section", embedding: "[0.1,0.2,0.3]" },
		])
		await repository.reindexChanged("openai:model-b")
		expect((await repository.statuses(owner.id)).get("guide.md")?.status).toBe("pending")
		const changed = await repository.claim("openai:model-b")
		if (!changed) throw new Error("Expected a model-change job")
		await repository.complete(retried, "openai:model-a", [{ text: "Stale", embedding: [1, 2, 3] }])
		expect((await repository.statuses(owner.id)).get("guide.md")?.status).toBe("processing")
		await repository.complete(changed, "openai:model-b", [{ text: "New", embedding: [3, 2, 1] }])
		expect((await repository.statuses(owner.id)).get("guide.md")?.status).toBe("ready")
		await repository.reindexChanged("openai:model-c")
		const interrupted = await repository.claim("openai:model-c")
		if (!interrupted) throw new Error("Expected a job before restart")
		await repository.recover()
		const recovered = await repository.claim("openai:model-c")
		if (!recovered) throw new Error("Expected a recovered job")
		await repository.complete(interrupted, "openai:model-c", [{ text: "Old worker", embedding: [9, 9, 9] }])
		expect((await repository.statuses(owner.id)).get("guide.md")?.status).toBe("processing")
		await repository.complete(recovered, "openai:model-c", [{ text: "Recovered", embedding: [4, 5, 6] }])
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
