import { agent } from "@/modules/agent/agent.schema.ts"
import { customType, index, integer, pgTable, primaryKey, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core"

const embeddingVector = customType<{ data: string }>({ dataType: () => "vector" })

export const agentFile = pgTable(
	"agent_file",
	{
		id: text("id").primaryKey(),
		agentId: text("agent_id")
			.notNull()
			.references(() => agent.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		status: text("status").notNull(),
		error: text("error"),
		modelKey: text("model_key"),
		generation: integer("generation").notNull().default(0),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
	},
	(table) => [
		uniqueIndex("agent_file_agent_name_idx").on(table.agentId, table.name),
		index("agent_file_status_idx").on(table.status),
	],
)

export const agentFileChunk = pgTable(
	"agent_file_chunk",
	{
		fileId: text("file_id")
			.notNull()
			.references(() => agentFile.id, { onDelete: "cascade" }),
		position: integer("position").notNull(),
		text: text("text").notNull(),
		embedding: embeddingVector("embedding").notNull(),
	},
	(table) => [primaryKey({ columns: [table.fileId, table.position] })],
)
