import { env } from "@/config/env.ts"
import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"

function createClient() {
	const sql = postgres(env.DATABASE_URL)
	return { db: drizzle({ client: sql }), sql }
}

// The client is created on first use, not at module load, so importing
// repositories never requires database configuration. The server entry point
// validates the full environment eagerly at boot.
let cached: ReturnType<typeof createClient> | undefined

function load(): ReturnType<typeof createClient> {
	return (cached ??= createClient())
}

export function getDb(): ReturnType<typeof createClient>["db"] {
	return load().db
}

export function getSql(): ReturnType<typeof createClient>["sql"] {
	return load().sql
}
