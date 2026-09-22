import { env } from "@/config/env.ts"
import * as agent from "@/modules/agent/agent.seed.ts"
import * as aiProvider from "@/modules/ai-provider/ai-provider.seed.ts"
import * as embed from "@/modules/embed/embed.seed.ts"
import * as identity from "@/modules/identity/identity.seed.ts"
import * as roles from "@/modules/roles/roles.seed.ts"

import { sql } from "./client.ts"

export async function seed(): Promise<void> {
	if (env.NODE_ENV !== "development" && env.NODE_ENV !== "test") {
		throw new Error("Database seeding is available only in development or test")
	}
	if (Bun.env.TALQO_ALLOW_INSECURE_SEED !== "true") {
		throw new Error("TALQO_ALLOW_INSECURE_SEED=true is required to create development fixtures")
	}

	await aiProvider.seed()
	if (!(await roles.hasAdmin())) {
		const adminId = await identity.seedAdmin()
		await roles.seedAdmin(adminId)
	}
	await identity.seedUser()
	await agent.seed()
	await embed.seed()
}

if (import.meta.main) {
	try {
		await seed()
		console.log("Database seeded")
	} finally {
		await sql.end()
	}
}
