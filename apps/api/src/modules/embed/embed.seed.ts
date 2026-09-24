import { db } from "@/db/client.ts"
import { DEFAULT_WIDGET_APPEARANCE } from "@talqo/shared/widget-appearance"

import { embed } from "./embed.schema.ts"

const SEED_AGENT_ID = "11111111-1111-4111-8111-111111111111"
const SEED_EMBED_ID = "22222222-2222-4222-8222-222222222222"
const SEED_EMBED_TOKEN = "F2qM7vR9xL4nK8pT6sW3yB5cD1hJ0uA9eG7iN2oQ4zX"

export async function seed(): Promise<void> {
	await db
		.insert(embed)
		.values({
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
		})
		.onConflictDoNothing({ target: embed.id })
}
