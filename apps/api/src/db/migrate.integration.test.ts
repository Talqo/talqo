import { env } from "@/config/env.ts"
import { effectivePermissions } from "@/modules/roles/roles.service.ts"
import { describe, expect, it } from "bun:test"
import { drizzle } from "drizzle-orm/postgres-js"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import { copyFile, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import postgres from "postgres"

import { sql } from "./client.ts"

describe("migrations", () => {
	it("upgrades legacy global grants to roles without activating scoped grants", async () => {
		const databaseName = `roles_upgrade_${crypto.randomUUID().replaceAll("-", "")}`
		const baseline = await mkdtemp(join(tmpdir(), "talqo-roles-upgrade-"))
		const migrationsFolder = join(import.meta.dir, "../../drizzle")
		await sql`CREATE DATABASE ${sql(databaseName)}`
		const url = new URL(env.DATABASE_URL)
		url.pathname = `/${databaseName}`
		const connection = postgres(url.toString())
		try {
			const journal = JSON.parse(await readFile(join(migrationsFolder, "meta/_journal.json"), "utf8")) as {
				entries: { idx: number; tag: string }[]
			}
			const entries = journal.entries.filter(({ idx }) => idx < 11)
			await mkdir(join(baseline, "meta"))
			await writeFile(join(baseline, "meta/_journal.json"), JSON.stringify({ ...journal, entries }))
			await Promise.all(
				entries.map(({ tag }) => copyFile(join(migrationsFolder, `${tag}.sql`), join(baseline, `${tag}.sql`))),
			)
			await connection`CREATE EXTENSION vector`
			const database = drizzle({ client: connection })
			await migrate(database, { migrationsFolder: baseline })
			await connection`INSERT INTO "user" (id, username, password_hash) VALUES
				('owner', 'old_admin', 'unused'), ('reader', 'old_reader', 'unused'),
				('reader-case', 'OLD_READER', 'unused'), ('scoped', 'old_scoped', 'unused')`
			await connection`INSERT INTO permission_grant (id, user_id, permission, agent_id) VALUES
				('admin-global', 'owner', 'admin', NULL),
				('admin-scoped', 'owner', 'admin', 'old-agent'),
				('scoped-admin', 'scoped', 'admin', 'old-agent'),
				('reader-manage', 'reader', 'agents:manage', NULL),
				('reader-read', 'reader', 'agents:read', NULL),
				('reader-read-duplicate', 'reader', 'agents:read', NULL),
				('reader-case-ai', 'reader-case', 'ai_provider:manage', NULL),
				('reader-scoped', 'reader', 'ai_provider:manage', 'old-agent'),
				('scoped-read', 'scoped', 'agents:read', 'old-agent')`

			await migrate(database, { migrationsFolder })

			const sources = await connection<{ permission: string }[]>`
				SELECT rp.permission FROM role_permission rp JOIN user_role ur ON ur.role_id = rp.role_id WHERE ur.user_id = 'reader'`
			expect(effectivePermissions(sources)).toEqual(["agents:read", "agents:manage"])
			expect([...(await connection`SELECT id, name FROM role ORDER BY id`)]).toEqual([
				{ id: "migrated:reader", name: "Migrated access: old_reader (1)" },
				{ id: "migrated:reader-case", name: "Migrated access: OLD_READER (2)" },
			])
			const otherSources = await connection<{ permission: string }[]>`
				SELECT rp.permission FROM role_permission rp JOIN user_role ur ON ur.role_id = rp.role_id WHERE ur.user_id = 'reader-case'`
			expect(effectivePermissions(otherSources)).toEqual(["ai_provider:manage"])
			expect([...(await connection`SELECT user_id, permission FROM permission_grant`)]).toEqual([
				{ user_id: "owner", permission: "admin" },
			])
			expect([...(await connection`SELECT * FROM user_role WHERE user_id = 'scoped'`)]).toEqual([])
			expect(
				(
					await connection`SELECT column_default FROM information_schema.columns WHERE table_name = 'embed' AND column_name = 'theme_toggle_enabled'`
				)[0]?.column_default,
			).toBe("false")
			await migrate(database, { migrationsFolder })
			expect([...(await connection`SELECT user_id FROM user_role ORDER BY user_id`)]).toEqual([
				{ user_id: "reader" },
				{ user_id: "reader-case" },
			])
		} finally {
			await connection.end()
			await sql`DROP DATABASE ${sql(databaseName)}`
			await rm(baseline, { recursive: true, force: true })
		}
	})
})
