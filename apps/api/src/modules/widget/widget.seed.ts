import { sql } from "@/db/client.ts"
import { DEFAULT_WIDGET_APPEARANCE } from "@talqo/shared/widget-appearance"

import * as repo from "./widget.repository.ts"
import * as service from "./widget.service.ts"

/** Fixed so the E2E host-page fixture can embed a known widget; real tokens are random. */
export const E2E_WIDGET_TOKEN = "e2e-marketing-widget-token"

export const E2E_WIDGET_PRIMARY = "#7c3aed"

export async function reset(): Promise<void> {
	await sql`TRUNCATE TABLE widget CASCADE`
}

export async function seed(agentId: string): Promise<{ publicToken: string }> {
	const marketing = await service.createWidget({
		agentId,
		name: "Marketing site",
		appearance: { ...DEFAULT_WIDGET_APPEARANCE, primary: E2E_WIDGET_PRIMARY, primaryForeground: "#ffffff" },
	})
	// Pinned afterwards so the service needs no test-only parameter.
	await repo.setPublicToken(marketing.id, E2E_WIDGET_TOKEN)

	await service.createWidget({
		agentId,
		name: "Support portal",
		appearance: { ...DEFAULT_WIDGET_APPEARANCE, position: "bottom-left" },
	})

	return { publicToken: E2E_WIDGET_TOKEN }
}
