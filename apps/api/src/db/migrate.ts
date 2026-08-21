import { migrate } from "drizzle-orm/postgres-js/migrator"
import { existsSync } from "node:fs"

import { getDb, getSql } from "./client.ts"

const migrationsFolder = `${import.meta.dir}/../../drizzle`

export async function runMigrations(): Promise<void> {
	if (!existsSync(`${migrationsFolder}/meta/_journal.json`)) return

	await migrate(getDb(), { migrationsFolder })
}

if (import.meta.main) {
	try {
		await runMigrations()
		console.log("Migrations up to date")
	} finally {
		await getSql().end()
	}
}
