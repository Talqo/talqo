import * as agent from "@/modules/agent/agent.seed.ts"
import * as aiProvider from "@/modules/ai-provider/ai-provider.seed.ts"
import * as identity from "@/modules/identity/identity.seed.ts"
import * as identityService from "@/modules/identity/identity.service.ts"
import * as roles from "@/modules/roles/roles.seed.ts"
import * as rolesService from "@/modules/roles/roles.service.ts"

import { sql } from "./client.ts"

export async function seed(): Promise<void> {
	// Dependents first: module tables must be clear before identity truncates `user`.
	await agent.reset()
	await aiProvider.reset()
	await roles.reset()
	await identity.reset()

	if (Bun.env.TALQO_SEED_PROFILE === "e2e") {
		const password = Bun.env.E2E_OPERATOR_PASSWORD
		const adminUsername = Bun.env.E2E_ADMIN_USERNAME
		const grantedUsername = Bun.env.E2E_GRANTED_USERNAME
		const ungrantedUsername = Bun.env.E2E_UNGRANTED_USERNAME
		const viewerUsername = Bun.env.E2E_VIEWER_USERNAME
		if (!password || !adminUsername || !grantedUsername || !ungrantedUsername || !viewerUsername) {
			throw new Error("E2E seed credentials are incomplete")
		}
		const admin = await rolesService.bootstrapAdmin({ username: adminUsername, password })
		const granted = await identityService.createAccount({ username: grantedUsername, password })
		await identityService.createAccount({ username: ungrantedUsername, password })
		const viewer = await identityService.createAccount({ username: viewerUsername, password })
		await rolesService.grantPermission({
			grantedBy: admin.id,
			permission: "ai_provider:manage",
			userId: granted.id,
		})
		await rolesService.grantPermission({ grantedBy: admin.id, permission: "agents:manage", userId: granted.id })
		await rolesService.grantPermission({ grantedBy: admin.id, permission: "agents:read", userId: viewer.id })
		await agent.seed()
	}
}

if (import.meta.main) {
	try {
		await seed()
		console.log("Database seeded")
	} finally {
		await sql.end()
	}
}
