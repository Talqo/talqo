import { agent } from "@/modules/agent/agent.schema.ts"
import { user } from "@/modules/identity/identity.schema.ts"
import { sql } from "drizzle-orm"
import { check, index, pgTable, primaryKey, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core"

export const invitation = pgTable(
	"invitation",
	{
		id: text("id").primaryKey(),
		tokenHash: text("token_hash").notNull().unique(),
		invitedBy: text("invited_by")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
		redeemedAt: timestamp("redeemed_at", { withTimezone: true, mode: "date" }),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
	},
	(table) => [index("invitation_invited_by_idx").on(table.invitedBy)],
)

export const permissionGrant = pgTable(
	"permission_grant",
	{
		id: text("id").primaryKey(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		// Only the admin grant remains; every other permission comes from roles.
		permission: text("permission").notNull(),
		grantedBy: text("granted_by").references(() => user.id, { onDelete: "set null" }),
		grantedAt: timestamp("granted_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
	},
	(table) => [
		index("permission_grant_user_id_idx").on(table.userId),
		// At most one global admin; the application also checks, but the constraint holds even when bypassed.
		uniqueIndex("permission_grant_admin_unique_idx")
			.on(table.permission)
			.where(sql`${table.permission} = 'admin'`),
		check("permission_grant_admin_only", sql`${table.permission} = 'admin'`),
	],
)

export const role = pgTable(
	"role",
	{
		id: text("id").primaryKey(),
		name: text("name").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
	},
	(table) => [uniqueIndex("role_name_unique_idx").on(sql`lower(${table.name})`)],
)

export const rolePermission = pgTable(
	"role_permission",
	{
		roleId: text("role_id")
			.notNull()
			.references(() => role.id, { onDelete: "cascade" }),
		// Free text; the API validates against the catalog, and only the admin grant may hold admin.
		permission: text("permission").notNull(),
	},
	(table) => [
		primaryKey({ columns: [table.roleId, table.permission] }),
		check("role_permission_not_admin", sql`${table.permission} <> 'admin'`),
	],
)

export const userRole = pgTable(
	"user_role",
	{
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		roleId: text("role_id")
			.notNull()
			.references(() => role.id, { onDelete: "cascade" }),
	},
	(table) => [primaryKey({ columns: [table.userId, table.roleId] }), index("user_role_role_id_idx").on(table.roleId)],
)

export const invitationRole = pgTable(
	"invitation_role",
	{
		invitationId: text("invitation_id")
			.notNull()
			.references(() => invitation.id, { onDelete: "cascade" }),
		roleId: text("role_id")
			.notNull()
			.references(() => role.id, { onDelete: "cascade" }),
	},
	(table) => [
		primaryKey({ columns: [table.invitationId, table.roleId] }),
		index("invitation_role_role_id_idx").on(table.roleId),
	],
)

export const roleAgentPermission = pgTable(
	"role_agent_permission",
	{
		roleId: text("role_id")
			.notNull()
			.references(() => role.id, { onDelete: "cascade" }),
		agentId: text("agent_id")
			.notNull()
			.references(() => agent.id, { onDelete: "cascade" }),
		permission: text("permission").notNull(),
	},
	(table) => [
		primaryKey({ columns: [table.roleId, table.agentId, table.permission] }),
		index("role_agent_permission_agent_id_idx").on(table.agentId),
		check(
			"role_agent_permission_catalog",
			sql`${table.permission} in ('stats:read', 'conversations:read', 'agents:read', 'agents:manage', 'agents:delete')`,
		),
	],
)
