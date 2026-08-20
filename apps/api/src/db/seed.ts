import * as agent from "@/modules/agent/agent.seed.ts"
import * as identity from "@/modules/identity/identity.seed.ts"
import * as roles from "@/modules/roles/roles.seed.ts"
import * as widget from "@/modules/widget/widget.seed.ts"

import { sql } from "./client.ts"

export type SeedResult = {
	operator: { password: string; username: string }
	widgetToken: string
}

export async function seed(): Promise<SeedResult> {
	// Dependents first: every module's tables reference the ones below it, so each must
	// be clear before its dependency truncates.
	await widget.reset()
	await roles.reset()
	await agent.reset()
	await identity.reset()

	// Then dependencies first, so each module's records exist before the next references them.
	const { userId } = await identity.seed()
	await roles.seed(userId)
	const { agentIds } = await agent.seed(userId)
	const [firstAgentId] = agentIds
	if (!firstAgentId) throw new Error("seed: agent seed produced no agents")
	const { publicToken } = await widget.seed(firstAgentId)

	return { operator: identity.E2E_OPERATOR, widgetToken: publicToken }
}

if (import.meta.main) {
	try {
		const result = await seed()
		// Single JSON line so scripts/test-e2e.ts can hand the records to Playwright
		// without apps/e2e importing API source.
		console.log(JSON.stringify(result))
	} finally {
		await sql.end()
	}
}
