import { agent } from "@/modules/agent/agent.schema.ts"
import { conversation, conversationAttempt } from "@/modules/conversation/conversation.schema.ts"
import { index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core"

export const conversationUsage = pgTable(
	"conversation_usage",
	{
		attemptId: text("attempt_id")
			.primaryKey()
			.references(() => conversationAttempt.id, { onDelete: "cascade" }),
		agentId: text("agent_id")
			.notNull()
			.references(() => agent.id, { onDelete: "cascade" }),
		conversationId: text("conversation_id")
			.notNull()
			.references(() => conversation.id, { onDelete: "cascade" }),
		provider: text("provider").notNull(),
		model: text("model").notNull(),
		outcome: text("outcome").notNull(),
		inputTokens: integer("input_tokens").notNull(),
		outputTokens: integer("output_tokens").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
	},
	(table) => [
		index("conversation_usage_agent_id_idx").on(table.agentId),
		index("conversation_usage_conversation_id_idx").on(table.conversationId),
	],
)
