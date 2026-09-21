import { agent } from "@/modules/agent/agent.schema.ts"
import { embed } from "@/modules/embed/embed.schema.ts"
import { sql } from "drizzle-orm"
import { boolean, check, index, integer, pgEnum, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core"

export const generationAttemptStatus = pgEnum("generation_attempt_status", [
	"accepted",
	"running",
	"completed",
	"failed",
	"cancelled",
	"blocked",
	"interrupted",
])
export const messageRole = pgEnum("message_role", ["user", "assistant"])
export const messageOutcome = pgEnum("message_outcome", [
	"streaming",
	"completed",
	"failed",
	"cancelled",
	"blocked",
	"interrupted",
])
export const generationAttemptFinalOutcome = pgEnum("generation_attempt_final_outcome", [
	"completed",
	"failed",
	"cancelled",
	"blocked",
	"interrupted",
])

export const conversation = pgTable(
	"conversation",
	{
		id: text("id").primaryKey(),
		agentId: text("agent_id")
			.notNull()
			.references(() => agent.id, { onDelete: "cascade" }),
		embedId: text("embed_id").references(() => embed.id, { onDelete: "set null" }),
		embedAccessVersion: integer("embed_access_version").notNull(),
		revision: integer("revision").notNull().default(0),
		latestCompletedMessageId: text("latest_completed_message_id"),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
	},
	(table) => [
		index("conversation_agent_id_idx").on(table.agentId),
		index("conversation_embed_id_idx").on(table.embedId),
	],
)

export const generationAttempt = pgTable(
	"generation_attempt",
	{
		id: text("id").primaryKey(),
		conversationId: text("conversation_id")
			.notNull()
			.references(() => conversation.id, { onDelete: "cascade" }),
		requestId: text("request_id").notNull(),
		inputText: text("input_text").notNull(),
		status: generationAttemptStatus("status").notNull().default("accepted"),
		networkHash: text("network_hash").notNull(),
		leaseToken: text("lease_token").notNull(),
		leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true, mode: "date" }).notNull(),
		cancellationRequestedAt: timestamp("cancellation_requested_at", { withTimezone: true, mode: "date" }),
		provider: text("provider"),
		model: text("model"),
		providerInvoked: boolean("provider_invoked").notNull().default(false),
		finalOutcome: generationAttemptFinalOutcome("final_outcome"),
		usageInputTokens: integer("usage_input_tokens"),
		usageOutputTokens: integer("usage_output_tokens"),
		usageRecordedAt: timestamp("usage_recorded_at", { withTimezone: true, mode: "date" }),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
	},
	(table) => [
		uniqueIndex("generation_attempt_conversation_request_unique_idx").on(table.conversationId, table.requestId),
		index("generation_attempt_active_network_idx").on(table.networkHash, table.status, table.leaseExpiresAt),
		index("generation_attempt_conversation_id_idx").on(table.conversationId),
		index("generation_attempt_recovery_idx")
			.on(table.leaseExpiresAt)
			.where(sql`${table.status} in ('accepted', 'running')`),
		index("generation_attempt_usage_pending_idx").on(table.providerInvoked, table.usageRecordedAt),
		check(
			"generation_attempt_usage_candidate_pair_check",
			sql`(${table.usageInputTokens} IS NULL) = (${table.usageOutputTokens} IS NULL)`,
		),
	],
)

export const message = pgTable(
	"message",
	{
		id: text("id").primaryKey(),
		conversationId: text("conversation_id")
			.notNull()
			.references(() => conversation.id, { onDelete: "cascade" }),
		generationAttemptId: text("generation_attempt_id")
			.notNull()
			.references(() => generationAttempt.id, { onDelete: "cascade" }),
		role: messageRole("role").notNull(),
		text: text("text").notNull(),
		outcome: messageOutcome("outcome").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
	},
	(table) => [
		index("message_order_idx").on(table.conversationId, table.createdAt, table.id),
		index("message_generation_attempt_idx").on(table.generationAttemptId),
	],
)

export const conversationDailyCounter = pgTable(
	"conversation_daily_counter",
	{
		agentId: text("agent_id")
			.notNull()
			.references(() => agent.id, { onDelete: "cascade" }),
		networkHash: text("network_hash").notNull(),
		day: text("day").notNull(),
		count: integer("count").notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
	},
	(table) => [uniqueIndex("conversation_daily_counter_unique_idx").on(table.agentId, table.networkHash, table.day)],
)
