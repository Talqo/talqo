import * as agent from "@/modules/agent/agent.seed.ts"
import * as aiProvider from "@/modules/ai-provider/ai-provider.seed.ts"
import * as identity from "@/modules/identity/identity.seed.ts"
import * as identityService from "@/modules/identity/identity.service.ts"
import * as roles from "@/modules/roles/roles.seed.ts"
import * as rolesService from "@/modules/roles/roles.service.ts"
import * as widget from "@/modules/widget/widget.seed.ts"

import { sql } from "./client.ts"

const TEST_PASSWORD = "correct-horse-battery-staple"
const TEST_USERS = {
	admin: "e2e_admin",
	granted: "e2e_granted",
	ungranted: "e2e_ungranted",
	viewer: "e2e_viewer",
} as const

export type SeedResult = {
	operator: { password: string; username: string }
	widgetToken: string
}

export async function seed(): Promise<SeedResult | null> {
	// Dependents first: module tables must be clear before identity truncates `user`.
	await widget.reset()
	await agent.reset()
	await aiProvider.reset()
	await roles.reset()
	await identity.reset()

	if (Bun.env.NODE_ENV === "test") {
		const admin = await rolesService.bootstrapAdmin({ username: TEST_USERS.admin, password: TEST_PASSWORD })
		const granted = await identityService.createAccount({ username: TEST_USERS.granted, password: TEST_PASSWORD })
		await identityService.createAccount({ username: TEST_USERS.ungranted, password: TEST_PASSWORD })
		const viewer = await identityService.createAccount({ username: TEST_USERS.viewer, password: TEST_PASSWORD })
		await rolesService.grantPermission({
			grantedBy: admin.id,
			permission: "ai_provider:manage",
			userId: granted.id,
		})
		await rolesService.grantPermission({ grantedBy: admin.id, permission: "agents:manage", userId: granted.id })
		await rolesService.grantPermission({ grantedBy: admin.id, permission: "agents:read", userId: viewer.id })
		const { agentId } = await agent.seed()
		const { publicToken } = await widget.seed(agentId)
		return { operator: { username: TEST_USERS.granted, password: TEST_PASSWORD }, widgetToken: publicToken }
	}

	return null
}

if (import.meta.main) {
	try {
		const result = await seed()
		// One JSON line for scripts/test-e2e.ts, so apps/e2e never imports API source.
		console.log(result ? JSON.stringify(result) : "Database seeded")
	} finally {
		await sql.end()
	}
}
