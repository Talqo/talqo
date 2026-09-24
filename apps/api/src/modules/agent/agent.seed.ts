import * as repo from "./agent.repository.ts"

const SEED_AGENT_ID = "11111111-1111-4111-8111-111111111111"
const SEED_AGENT_NAME = "Website Assistant"

const SEED_AGENT_PROMPT =
	"You are the support assistant on our company website. Help visitors with questions about our product, pricing, and documentation. Be concise and friendly, and say honestly when you do not know something."
const SEED_AGENT_BLACKLIST = ["Intercom", "Zendesk"] as const

export async function seed(): Promise<void> {
	if (await repo.findByIdWithWords(SEED_AGENT_ID)) return
	await repo.insertWithWords(
		{
			id: SEED_AGENT_ID,
			name: SEED_AGENT_NAME,
			systemPrompt: SEED_AGENT_PROMPT,
		},
		[...SEED_AGENT_BLACKLIST],
	)
}
