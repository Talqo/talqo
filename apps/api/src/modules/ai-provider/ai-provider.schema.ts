import { sql } from "drizzle-orm"
import { check, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core"

import type { StoredEmbeddingConfiguration, StoredTextConfiguration } from "./ai-provider.types.ts"

export const aiProviderConfig = pgTable(
	"ai_provider_config",
	{
		id: text("id").primaryKey(),
		revision: integer("revision").notNull(),
		text: jsonb("text_config").$type<StoredTextConfiguration>().notNull(),
		embedding: jsonb("embedding_config").$type<StoredEmbeddingConfiguration>().notNull(),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
	},
	(table) => [check("ai_provider_config_singleton_check", sql`${table.id} = 'singleton'`)],
)
