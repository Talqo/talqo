import { env } from "@/config/env.ts"
import { sql } from "@/db/client.ts"
import { rm } from "node:fs/promises"

export async function reset(): Promise<void> {
	await sql`TRUNCATE TABLE agent`
	// Uploaded files live outside the database; e2e reseeds before every run, so wipe them too.
	await rm(env.TALQO_UPLOAD_DIR, { force: true, recursive: true })
}
