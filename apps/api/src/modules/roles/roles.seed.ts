import { sql } from "@/db/client.ts"

import * as service from "./roles.service.ts"

export async function reset(): Promise<void> {
	await sql`TRUNCATE TABLE user_role, invitation, permission_grant`
}

/** Unscoped grant: the seeded operator manages every seeded agent and widget. */
export async function seed(userId: string): Promise<void> {
	await service.grantPermission({ userId, permission: "agents:write", grantedBy: userId })
}
