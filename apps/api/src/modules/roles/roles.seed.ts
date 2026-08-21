import { getSql } from "@/db/client.ts"

export async function reset(): Promise<void> {
	await getSql()`TRUNCATE TABLE user_role, invitation, permission_grant`
}
