import { sql } from "@/db/client.ts"

export async function reset(): Promise<void> {
	await sql`TRUNCATE TABLE invitation, permission_grant`
}
