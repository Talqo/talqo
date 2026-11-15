import { env } from "@/config/env.ts"
import * as agent from "@/modules/agent/agent.seed.ts"
import * as aiProvider from "@/modules/ai-provider/ai-provider.seed.ts"
import * as conversation from "@/modules/conversation/conversation.seed.ts"
import * as embed from "@/modules/embed/embed.seed.ts"
import * as identity from "@/modules/identity/identity.seed.ts"
import * as mcp from "@/modules/mcp/mcp.seed.ts"
import * as roles from "@/modules/roles/roles.seed.ts"
import * as usage from "@/modules/usage/usage.seed.ts"

import { sql } from "./client.ts"
import { assertSeedAllowed } from "./seed-policy.ts"

export async function seed(): Promise<void> {
	assertSeedAllowed(env.NODE_ENV, Bun.env.TALQO_ALLOW_INSECURE_SEED)

	await aiProvider.seed()
	if (!(await roles.hasAdmin())) {
		const adminId = await identity.seedAdmin()
		await roles.seedAdmin(adminId)
	}
	await identity.seedUser()
	await roles.seed()
	await agent.seed()
	await roles.seedAgentAccess(agent.SEED_AGENT_IDS)
	await embed.seed()
	await mcp.seed()
	const seededAttempts = await conversation.seed()
	await usage.seed(seededAttempts)
}

if (import.meta.main) {
	try {
		await seed()
		console.log("Database seeded")
	} finally {
		await sql.end()
	}
}
