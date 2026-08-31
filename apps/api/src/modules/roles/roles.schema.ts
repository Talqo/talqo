import { user } from "@/modules/identity/identity.schema.ts"
import { sql } from "drizzle-orm"
import { index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core"

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
		// Free text, not a DB enum: each module with mutating routes owns its own permission strings.
		permission: text("permission").notNull(),
		// Legacy: grants are global now, and authorization ignores rows where this is set.
		agentId: text("agent_id"),
		// Nullable + set null (not cascade): deleting the granting user's account must not
		// silently revoke grants they made to other, unrelated users.
		grantedBy: text("granted_by").references(() => user.id, { onDelete: "set null" }),
		grantedAt: timestamp("granted_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
	},
	(table) => [
		index("permission_grant_user_id_idx").on(table.userId),
		// At most one global admin; the application also checks, but the constraint holds even when bypassed.
		uniqueIndex("permission_grant_admin_unique_idx")
			.on(table.permission)
			.where(sql`${table.permission} = 'admin' AND ${table.agentId} IS NULL`),
	],
)
