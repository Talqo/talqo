import { user } from "@/modules/identity/identity.schema.ts"
import { index, pgEnum, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core"

export const agentStatusEnum = pgEnum("agent_status", ["active", "paused"])

export const agent = pgTable(
	"agent",
	{
		id: text("id").primaryKey(),
		// Nullable + set null (not cascade), mirroring `permission_grant.granted_by`:
		// deleting the operator who happened to create an agent must not take down an
		// agent that is answering end users on live customer sites.
		ownerId: text("owner_id").references(() => user.id, { onDelete: "set null" }),
		name: text("name").notNull(),
		systemPrompt: text("system_prompt").notNull().default(""),
		status: agentStatusEnum("status").notNull().default("active"),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
	},
	(table) => [index("agent_owner_id_idx").on(table.ownerId)],
)

export const blacklistWord = pgTable(
	"blacklist_word",
	{
		id: text("id").primaryKey(),
		agentId: text("agent_id")
			.notNull()
			.references(() => agent.id, { onDelete: "cascade" }),
		word: text("word").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
	},
	// Own table rather than a text[] column (docs/ERD.md models BLACKLIST_WORD as an
	// entity); the unique index makes replacing a list idempotent without app-side dedupe.
	(table) => [uniqueIndex("blacklist_word_agent_id_word_idx").on(table.agentId, table.word)],
)
