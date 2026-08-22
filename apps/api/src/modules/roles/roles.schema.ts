import { user } from "@/modules/identity/identity.schema.ts"
import { sql } from "drizzle-orm"
import { index, pgEnum, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core"

export const roleEnum = pgEnum("role", ["admin"])

export const userRole = pgTable(
	"user_role",
	{
		id: text("id").primaryKey(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		role: roleEnum("role").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
	},
	// Partial index, not a table-wide constraint: enforces "at most one admin" today while
	// leaving room for future non-exclusive roles to allow multiple rows per user.
	(table) => [
		uniqueIndex("user_role_admin_unique_idx")
			.on(table.role)
			.where(sql`${table.role} = 'admin'`),
		index("user_role_user_id_idx").on(table.userId),
	],
)

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
		// Nullable + set null (not cascade): deleting the granting admin's account must not
		// silently revoke grants they made to other, unrelated users.
		grantedBy: text("granted_by").references(() => user.id, { onDelete: "set null" }),
		grantedAt: timestamp("granted_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
	},
	(table) => [index("permission_grant_user_id_idx").on(table.userId)],
)
