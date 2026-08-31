import { agent } from "@/modules/agent/agent.schema.ts"
import { boolean, index, pgEnum, pgTable, text, timestamp } from "drizzle-orm/pg-core"

export const widgetPositionEnum = pgEnum("widget_position", ["bottom-right", "bottom-left"])
export const widgetThemeEnum = pgEnum("widget_theme", ["system", "light", "dark"])

/**
 * One column per setting rather than a jsonb blob: the set is closed (SRS 3.2.5), enums
 * plus NOT NULL make an invalid row unrepresentable, and changes show in the migration.
 */
export const widget = pgTable(
	"widget",
	{
		id: text("id").primaryKey(),
		// Restrict, not cascade: deleting the agent would break every embed already pasted.
		agentId: text("agent_id")
			.notNull()
			.references(() => agent.id, { onDelete: "restrict" }),
		name: text("name").notNull(),
		// A public identifier printed into every host page, not a bearer credential, so it is
		// stored in the clear: hashing adds nothing and loses the snippet after creation.
		publicToken: text("public_token").notNull().unique(),
		primaryColor: text("primary_color").notNull(),
		primaryForegroundColor: text("primary_foreground_color").notNull(),
		backgroundColor: text("background_color").notNull(),
		foregroundColor: text("foreground_color").notNull(),
		position: widgetPositionEnum("position").notNull().default("bottom-right"),
		theme: widgetThemeEnum("theme").notNull().default("system"),
		themeToggleEnabled: boolean("theme_toggle_enabled").notNull().default(true),
		// text, not an enum: `@talqo/shared` owns the set, and an enum costs a migration per language.
		language: text("language").notNull().default("en"),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
	},
	(table) => [index("widget_agent_id_idx").on(table.agentId)],
)
