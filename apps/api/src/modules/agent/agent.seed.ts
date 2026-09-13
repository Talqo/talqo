import { sql } from "@/db/client.ts"

import * as repo from "./agent.repository.ts"

const SEED_AGENT_NAME = "Website Assistant"

const SEED_AGENT_PROMPT =
	"You are the support assistant on our company website. Help visitors with questions about our product, pricing, and documentation. Be concise and friendly, and say honestly when you do not know something."
const SEED_AGENT_BLACKLIST = ["Intercom", "Zendesk"] as const

export async function reset(): Promise<void> {
	// Dependents first, and CASCADE because `embed` also references `agent`.
	await sql`TRUNCATE TABLE blacklist_word, agent CASCADE`
}

export async function seed(name = SEED_AGENT_NAME): Promise<{ agentId: string }> {
	const agentId = crypto.randomUUID()
	await repo.insertWithWords(
		{
			id: agentId,
			name,
			systemPrompt: SEED_AGENT_PROMPT,
		},
		[...SEED_AGENT_BLACKLIST],
	)
	return { agentId }
}
