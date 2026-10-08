import * as repo from "./agent.repository.ts"

const SEED_AGENT_ID = "11111111-1111-4111-8111-111111111111"

// Extra agents keep the development dashboard filter and breakdown worth exploring.
const SEED_AGENTS = [
	{
		id: SEED_AGENT_ID,
		name: "Website Assistant",
		systemPrompt:
			"You are the support assistant on our company website. Help visitors with questions about our product, pricing, and documentation. Be concise and friendly, and say honestly when you do not know something.",
		wordBlacklist: ["Intercom", "Zendesk"],
	},
	{
		id: "33333333-3333-4333-8333-333333333333",
		name: "Product Advisor",
		systemPrompt:
			"You help shoppers compare our products and pick the one that fits their needs. Ask about their use case before recommending, and mention relevant pricing tiers.",
		wordBlacklist: [],
	},
	{
		id: "44444444-4444-4444-8444-444444444444",
		name: "Docs Assistant",
		systemPrompt:
			"You answer questions strictly from the internal knowledge base. Quote the relevant article when you can, and say when the answer is not covered.",
		wordBlacklist: [],
	},
]

export async function seed(): Promise<void> {
	await Promise.all(
		SEED_AGENTS.map(async (agent) => {
			if (await repo.findByIdWithWords(agent.id)) {
				await repo.updateWithWords(
					agent.id,
					{ name: agent.name, systemPrompt: agent.systemPrompt },
					agent.wordBlacklist,
				)
			} else {
				await repo.insertWithWords(
					{ id: agent.id, name: agent.name, systemPrompt: agent.systemPrompt },
					agent.wordBlacklist,
				)
			}
		}),
	)
}
