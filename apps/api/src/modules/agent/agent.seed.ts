import { sql } from "@/db/client.ts"

import * as service from "./agent.service.ts"

export async function reset(): Promise<void> {
	await sql`TRUNCATE TABLE blacklist_word, agent CASCADE`
}

export async function seed(ownerId: string): Promise<{ agentIds: string[] }> {
	const docs = await service.createAgent({
		name: "Docs helper",
		ownerId,
		systemPrompt: "You answer questions from the product docs.",
		wordBlacklist: ["spam", "abuse"],
	})
	const sales = await service.createAgent({
		name: "Sales assistant",
		ownerId,
		systemPrompt: "You help visitors choose a plan.",
	})
	return { agentIds: [docs.id, sales.id] }
}
