import { sql } from "drizzle-orm"
import { index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core"

export const agent = pgTable(
	"agent",
	{
		id: text("id").primaryKey(),
		name: text("name").notNull(),
		systemPrompt: text("system_prompt").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
	},
	(table) => [uniqueIndex("agent_name_unique_idx").on(sql`lower(${table.name})`)],
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
	(table) => [
		index("blacklist_word_agent_id_idx").on(table.agentId),
		uniqueIndex("blacklist_word_agent_word_unique_idx").on(table.agentId, sql`lower(${table.word})`),
	],
)
