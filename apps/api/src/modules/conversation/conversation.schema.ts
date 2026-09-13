import { agent } from "@/modules/agent/agent.schema.ts"
import { embed } from "@/modules/embed/embed.schema.ts"
import { sql } from "drizzle-orm"
import { boolean, check, index, integer, pgEnum, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core"

export const conversationAttemptStatus = pgEnum("conversation_attempt_status", [
	"accepted",
	"running",
	"completed",
	"failed",
	"cancelled",
	"blocked",
	"interrupted",
])
export const conversationMessageRole = pgEnum("conversation_message_role", ["user", "assistant"])
export const conversationMessageOutcome = pgEnum("conversation_message_outcome", [
	"streaming",
	"completed",
	"failed",
	"cancelled",
	"blocked",
	"interrupted",
])
export const conversationFinalOutcome = pgEnum("conversation_final_outcome", [
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
		revision: integer("revision").notNull().default(0),
		latestCompletedMessageId: text("latest_completed_message_id"),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
	},
	(table) => [
		index("conversation_agent_id_idx").on(table.agentId),
		index("conversation_embed_id_idx").on(table.embedId),
	],
)

export const conversationSession = pgTable(
	"conversation_session",
	{
		id: text("id").primaryKey(),
		conversationId: text("conversation_id")
			.notNull()
			.unique()
			.references(() => conversation.id, { onDelete: "cascade" }),
		embedId: text("embed_id").references(() => embed.id, { onDelete: "set null" }),
		embedAccessVersion: integer("embed_access_version").notNull(),
		credentialHash: text("credential_hash").notNull().unique(),
		bootstrapRequestId: text("bootstrap_request_id").notNull(),
		bootstrapSecretHash: text("bootstrap_secret_hash").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
	},
	(table) => [
		uniqueIndex("conversation_session_bootstrap_unique_idx").on(
			table.embedId,
			table.embedAccessVersion,
			table.bootstrapRequestId,
		),
		index("conversation_session_embed_id_idx").on(table.embedId),
	],
)

export const conversationAttempt = pgTable(
	"conversation_attempt",
	{
		id: text("id").primaryKey(),
		conversationId: text("conversation_id")
			.notNull()
			.references(() => conversation.id, { onDelete: "cascade" }),
		sessionId: text("session_id")
			.notNull()
			.references(() => conversationSession.id, { onDelete: "cascade" }),
		requestId: text("request_id").notNull(),
		requestTextHash: text("request_text_hash").notNull(),
		inputText: text("input_text").notNull(),
		status: conversationAttemptStatus("status").notNull().default("accepted"),
		networkHash: text("network_hash").notNull(),
		leaseToken: text("lease_token").notNull(),
		leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true, mode: "date" }).notNull(),
		cancellationRequestedAt: timestamp("cancellation_requested_at", { withTimezone: true, mode: "date" }),
		provider: text("provider"),
		model: text("model"),
		providerInvoked: boolean("provider_invoked").notNull().default(false),
		finalOutcome: conversationFinalOutcome("final_outcome"),
		usageInputTokens: integer("usage_input_tokens"),
		usageOutputTokens: integer("usage_output_tokens"),
		usageRecordedAt: timestamp("usage_recorded_at", { withTimezone: true, mode: "date" }),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
	},
	(table) => [
		uniqueIndex("conversation_attempt_session_request_unique_idx").on(table.sessionId, table.requestId),
		index("conversation_attempt_active_network_idx").on(table.networkHash, table.status, table.leaseExpiresAt),
		index("conversation_attempt_conversation_id_idx").on(table.conversationId),
		index("conversation_attempt_usage_pending_idx").on(table.providerInvoked, table.usageRecordedAt),
		check(
			"conversation_attempt_usage_candidate_pair_check",
			sql`(${table.usageInputTokens} IS NULL) = (${table.usageOutputTokens} IS NULL)`,
		),
	],
)

export const conversationMessage = pgTable(
	"conversation_message",
	{
		id: text("id").primaryKey(),
		conversationId: text("conversation_id")
			.notNull()
			.references(() => conversation.id, { onDelete: "cascade" }),
		attemptId: text("attempt_id")
			.notNull()
			.references(() => conversationAttempt.id, { onDelete: "cascade" }),
		role: conversationMessageRole("role").notNull(),
		text: text("text").notNull(),
		outcome: conversationMessageOutcome("outcome").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
	},
	(table) => [index("conversation_message_order_idx").on(table.conversationId, table.createdAt, table.id)],
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
