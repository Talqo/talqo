import { db } from "@/db/client.ts"
import { DEFAULT_WIDGET_APPEARANCE } from "@talqo/shared/widget-appearance"

import { embed } from "./embed.schema.ts"

const SEED_AGENT_ID = "talqo-seed-agent"
const SEED_EMBED_ID = "talqo-seed-embed"
const SEED_EMBED_TOKEN = "talqo-development-embed-token"

export async function seed(): Promise<void> {
	const values = {
		id: SEED_EMBED_ID,
		agentId: SEED_AGENT_ID,
		name: "Website",
		embedToken: SEED_EMBED_TOKEN,
		lightPrimaryColor: DEFAULT_WIDGET_APPEARANCE.light.primary,
		lightTextOnPrimaryColor: DEFAULT_WIDGET_APPEARANCE.light.textOnPrimary,
		lightBackgroundColor: DEFAULT_WIDGET_APPEARANCE.light.background,
		lightSurfaceColor: DEFAULT_WIDGET_APPEARANCE.light.surface,
		lightTextColor: DEFAULT_WIDGET_APPEARANCE.light.text,
		darkPrimaryColor: DEFAULT_WIDGET_APPEARANCE.dark.primary,
		darkTextOnPrimaryColor: DEFAULT_WIDGET_APPEARANCE.dark.textOnPrimary,
		darkBackgroundColor: DEFAULT_WIDGET_APPEARANCE.dark.background,
		darkSurfaceColor: DEFAULT_WIDGET_APPEARANCE.dark.surface,
		darkTextColor: DEFAULT_WIDGET_APPEARANCE.dark.text,
		position: DEFAULT_WIDGET_APPEARANCE.position,
		theme: DEFAULT_WIDGET_APPEARANCE.theme,
		themeToggleEnabled: DEFAULT_WIDGET_APPEARANCE.themeToggle,
		language: DEFAULT_WIDGET_APPEARANCE.language,
	}
	const updates: Partial<typeof values> = { ...values }
	delete updates.id
	await db
		.insert(embed)
		.values(values)
		.onConflictDoUpdate({
			target: embed.id,
			set: { ...updates, updatedAt: new Date() },
		})
}
