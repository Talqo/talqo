import { user } from "@/modules/identity/identity.schema.ts"
import { boolean, index, integer, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core"

export const agent = pgTable(
	"agent",
	{
		id: text("id").primaryKey(),
		ownerId: text("owner_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		systemPrompt: text("system_prompt").notNull().default(""),
		wordBlacklist: text("word_blacklist").array().notNull().default([]),
		active: boolean("active").notNull().default(true),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
	},
	(table) => [
		uniqueIndex("agent_owner_name_unique_idx").on(table.ownerId, table.name),
		index("agent_owner_id_idx").on(table.ownerId),
	],
)

export const agentFile = pgTable(
	"agent_file",
	{
		id: text("id").primaryKey(),
		agentId: text("agent_id")
			.notNull()
			.references(() => agent.id, { onDelete: "cascade" }),
		originalName: text("original_name").notNull(),
		// Random name on disk: avoids collisions and path traversal from original_name.
		storedName: text("stored_name").notNull(),
		mimeType: text("mime_type").notNull(),
		sizeBytes: integer("size_bytes").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
	},
	(table) => [index("agent_file_agent_id_idx").on(table.agentId)],
)
