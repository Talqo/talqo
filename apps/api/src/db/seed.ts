import * as identity from "@/modules/identity/identity.seed.ts"
import * as roles from "@/modules/roles/roles.seed.ts"

import { getSql } from "./client.ts"

export async function seed(): Promise<void> {
	// Dependents first: `roles`' tables reference `identity`'s, so they must be clear
	// before identity truncates `user`.
	await roles.reset()
	await identity.reset()
}

if (import.meta.main) {
	try {
		await seed()
		console.log("Database seeded")
	} finally {
		await getSql().end()
	}
}
