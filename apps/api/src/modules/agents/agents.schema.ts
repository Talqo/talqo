import { user } from "@/modules/identity/identity.schema.ts"
import { boolean, index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core"

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
