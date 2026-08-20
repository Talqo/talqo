import { agent } from "@/modules/agent/agent.schema.ts"
import { boolean, index, pgEnum, pgTable, text, timestamp } from "drizzle-orm/pg-core"

export const widgetPositionEnum = pgEnum("widget_position", ["bottom-right", "bottom-left"])
export const widgetThemeEnum = pgEnum("widget_theme", ["system", "light", "dark"])

/**
 * One column per setting rather than a jsonb blob: the set is closed and enumerated
 * by SRS 3.2.5, enums plus NOT NULL make an invalid row unrepresentable, and a column
 * change is visible in the generated SQL that ADR-0004's review step depends on.
 */
export const widget = pgTable(
	"widget",
	{
		id: text("id").primaryKey(),
		// Restrict, not cascade: deleting an agent that still serves widgets would break
		// every embed snippet already pasted onto customer sites.
		agentId: text("agent_id")
			.notNull()
			.references(() => agent.id, { onDelete: "restrict" }),
		name: text("name").notNull(),
		// Stored in the clear, unlike `invitation.token_hash`. This is a public identifier
		// printed into every page the widget runs on, not a bearer credential; hashing adds
		// no confidentiality and would make the embed snippet unrecoverable after creation.
		publicToken: text("public_token").notNull().unique(),
		primaryColor: text("primary_color").notNull(),
		primaryForegroundColor: text("primary_foreground_color").notNull(),
		backgroundColor: text("background_color").notNull(),
		foregroundColor: text("foreground_color").notNull(),
		position: widgetPositionEnum("position").notNull().default("bottom-right"),
		theme: widgetThemeEnum("theme").notNull().default("system"),
		themeToggleEnabled: boolean("theme_toggle_enabled").notNull().default(true),
		// text, not an enum: the supported set lives in `@talqo/shared` and grows on its own
		// schedule; a DB enum would force a migration per added language.
		language: text("language").notNull().default("en"),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
	},
	(table) => [index("widget_agent_id_idx").on(table.agentId)],
)
