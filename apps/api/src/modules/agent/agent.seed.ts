import { sql } from "@/db/client.ts"

import * as repo from "./agent.repository.ts"

const SEED_AGENT_NAME = "Website Assistant"

const SEED_AGENT_PROMPT =
	"You are the support assistant on our company website. Help visitors with questions about our product, pricing, and documentation. Be concise and friendly, and say honestly when you do not know something."
const SEED_AGENT_BLACKLIST = ["Intercom", "Zendesk"] as const

export async function reset(): Promise<void> {
	// Dependents first: `blacklist_word` references `agent`.
	await sql`TRUNCATE TABLE blacklist_word, agent`
}

export async function seed(): Promise<void> {
	await repo.insertWithWords(
		{
			id: crypto.randomUUID(),
			name: SEED_AGENT_NAME,
			systemPrompt: SEED_AGENT_PROMPT,
		},
		[...SEED_AGENT_BLACKLIST],
	)
}
