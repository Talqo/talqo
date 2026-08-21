import { getSql } from "@/db/client.ts"

export async function reset(): Promise<void> {
	// CASCADE is required: Postgres refuses to truncate `user` while roles' tables still reference it.
	await getSql()`TRUNCATE TABLE session, "user" CASCADE`
}
