import type { CredentialEnvelope, CredentialSecretMap } from "@/lib/credential-vault.ts"

import { agent } from "@/modules/agent/agent.schema.ts"
import { sql } from "drizzle-orm"
import {
	boolean,
	check,
	index,
	integer,
	jsonb,
	pgEnum,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core"

import type { McpToolSnapshot } from "./mcp.types.ts"

export const mcpTransportEnum = pgEnum("mcp_transport", ["http", "stdio"])
export const mcpAuthModeEnum = pgEnum("mcp_auth_mode", ["none", "headers", "oauth"])

export const mcpServer = pgTable(
	"mcp_server",
	{
		id: text("id").primaryKey(),
		agentId: text("agent_id")
			.notNull()
			.references(() => agent.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		transport: mcpTransportEnum("transport").notNull(),
		url: text("url"),
		authMode: mcpAuthModeEnum("auth_mode"),
		headers: jsonb("headers").$type<CredentialSecretMap>(),
		oauthTokens: jsonb("oauth_tokens").$type<CredentialEnvelope>(),
		oauthClient: jsonb("oauth_client").$type<CredentialEnvelope>(),
		oauthPending: jsonb("oauth_pending").$type<CredentialEnvelope>(),
		oauthStateExpiresAt: timestamp("oauth_state_expires_at", { withTimezone: true, mode: "date" }),
		command: text("command"),
		args: jsonb("args")
			.$type<string[]>()
			.notNull()
			.default(sql`'[]'::jsonb`),
		env: jsonb("env")
			.$type<CredentialSecretMap>()
			.notNull()
			.default(sql`'{}'::jsonb`),
		tools: jsonb("tools")
			.$type<McpToolSnapshot[]>()
			.notNull()
			.default(sql`'[]'::jsonb`),
		health: text("health").notNull().default("unconfigured"),
		healthDetail: text("health_detail"),
		isDisabled: boolean("is_disabled").notNull().default(false),
		revision: integer("revision").notNull().default(1),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
	},
	(table) => [
		index("mcp_server_agent_id_idx").on(table.agentId),
		uniqueIndex("mcp_server_agent_name_unique_idx").on(table.agentId, sql`lower(${table.name})`),
		check(
			"mcp_server_transport_fields_check",
			sql`(
				${table.transport} = 'http' AND ${table.url} IS NOT NULL AND ${table.command} IS NULL
					AND ${table.authMode} IS NOT NULL
					AND ${table.args} = '[]'::jsonb AND ${table.env} = '{}'::jsonb
			) OR (
				${table.transport} = 'stdio' AND ${table.command} IS NOT NULL AND ${table.url} IS NULL
					AND ${table.authMode} IS NULL
			)`,
		),
		// A row entering oauth mode may hold no token yet, so only the reverse direction is forbidden.
		// `IS NOT DISTINCT FROM` rather than `=`: a stdio row's null auth_mode would make `=` yield
		// null, and a check whose result is null passes, admitting any secret column.
		check(
			"mcp_server_auth_fields_check",
			sql`(
				(${table.authMode} IS NULL OR ${table.authMode} = 'none')
					AND ${table.headers} IS NULL AND ${table.oauthTokens} IS NULL
					AND ${table.oauthClient} IS NULL AND ${table.oauthPending} IS NULL
					AND ${table.oauthStateExpiresAt} IS NULL
			) OR (
				${table.authMode} IS NOT DISTINCT FROM 'headers' AND ${table.headers} IS NOT NULL
					AND ${table.oauthTokens} IS NULL AND ${table.oauthClient} IS NULL
					AND ${table.oauthPending} IS NULL AND ${table.oauthStateExpiresAt} IS NULL
			) OR (
				${table.authMode} IS NOT DISTINCT FROM 'oauth' AND ${table.headers} IS NULL
					AND (${table.oauthPending} IS NULL) = (${table.oauthStateExpiresAt} IS NULL)
			)`,
		),
	],
)

export type McpServerRow = typeof mcpServer.$inferSelect
export type NewMcpServer = typeof mcpServer.$inferInsert
export type McpServerPatch = Partial<Omit<NewMcpServer, "id" | "agentId" | "createdAt">>
