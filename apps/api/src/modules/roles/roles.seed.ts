import { sql } from "@/db/client.ts"

export async function reset(): Promise<void> {
	await sql`TRUNCATE TABLE user_role, invitation, permission_grant`
}
