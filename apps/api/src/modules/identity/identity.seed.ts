import { sql } from "@/db/client.ts"

export async function reset(): Promise<void> {
	// CASCADE is required syntax here, not a boundary violation: Postgres refuses to
	// truncate a table with any incoming FK regardless of current row count, and
	// `roles`' tables reference `user`. Callers must reset `roles` first so this is a
	// no-op cascade in practice, not identity clearing another module's data.
	await sql`TRUNCATE TABLE session, "user" CASCADE`
}
