import { sql } from "@/db/client.ts"
import { DEFAULT_WIDGET_APPEARANCE } from "@talqo/shared/widget-appearance"

import * as repo from "./embed.repository.ts"
import * as service from "./embed.service.ts"

/** Fixed so the E2E host-page fixture can embed a known widget; real tokens are random. */
const E2E_EMBED_TOKEN = "e2e-marketing-embed-token"

const E2E_WIDGET_PRIMARY = "#7c3aed"

export async function reset(): Promise<void> {
	await sql`TRUNCATE TABLE embed CASCADE`
}

export async function seed(agentId: string): Promise<{ embedToken: string }> {
	const marketing = await service.createEmbed({
		agentId,
		name: "Marketing site",
		appearance: {
			...DEFAULT_WIDGET_APPEARANCE,
			light: { ...DEFAULT_WIDGET_APPEARANCE.light, primary: E2E_WIDGET_PRIMARY, textOnPrimary: "#ffffff" },
		},
	})
	// Pinned afterwards so the service needs no test-only parameter.
	await repo.setEmbedToken(marketing.id, E2E_EMBED_TOKEN)

	await service.createEmbed({
		agentId,
		name: "Support portal",
		appearance: { ...DEFAULT_WIDGET_APPEARANCE, position: "bottom-left" },
	})

	return { embedToken: E2E_EMBED_TOKEN }
}
