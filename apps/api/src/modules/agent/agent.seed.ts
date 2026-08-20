import { sql } from "@/db/client.ts"

import * as repo from "./agent.repository.ts"

const SEED_AGENT_NAME = "Website Assistant"

const SEED_AGENT_PROMPT =
	"You are the support assistant on our company website. Help visitors with questions about our product, pricing, and documentation. Be concise and friendly, and say honestly when you do not know something."
const SEED_AGENT_BLACKLIST = ["Intercom", "Zendesk"] as const

export async function reset(): Promise<void> {
	// Dependents first: `blacklist_word` references `agent`. CASCADE because `widget`
	// also references `agent`, and Postgres refuses to truncate a referenced table.
	await sql`TRUNCATE TABLE blacklist_word, agent CASCADE`
}

export async function seed(): Promise<{ agentId: string }> {
	const agentId = crypto.randomUUID()
	await repo.insertWithWords(
		{
			id: agentId,
			name: SEED_AGENT_NAME,
			systemPrompt: SEED_AGENT_PROMPT,
		},
		[...SEED_AGENT_BLACKLIST],
	)
	return { agentId }
}
