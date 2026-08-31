import type { WidgetAppearance } from "@talqo/shared/widget-appearance"

import { generateOpaqueToken } from "@/lib/opaque-token.ts"
import { isForeignKeyViolation } from "@/lib/pg-error.ts"
import { WIDGET_CONFIG_VERSION } from "@talqo/shared/widget-appearance"

import * as repo from "./widget.repository.ts"

export const WIDGET_NAME_MAX_LENGTH = 80

/**
 * Exempted from authentication in `http/require-auth.ts`, so it is anchored at both ends
 * over a single segment and kept off the authenticated `/api/widgets` namespace.
 */
export const PUBLIC_PATH_PATTERNS = [/^\/api\/widget-config\/[^/]+$/] as const

export type Widget = {
	agentId: string
	appearance: WidgetAppearance
	id: string
	name: string
	publicToken: string
}

export type WidgetConfig = {
	agentId: string
	appearance: WidgetAppearance
	name: string
	updatedAt: Date
	version: number
}

export type WidgetInput = {
	agentId: string
	appearance: WidgetAppearance
	name: string
}

export class WidgetNotFoundError extends Error {}
export class UnknownAgentError extends Error {}

type WidgetRow = NonNullable<Awaited<ReturnType<typeof repo.findWidget>>>

function toWidget(row: WidgetRow): Widget {
	return {
		id: row.id,
		agentId: row.agentId,
		name: row.name,
		publicToken: row.publicToken,
		appearance: {
			light: {
				primary: row.lightPrimaryColor,
				textOnPrimary: row.lightTextOnPrimaryColor,
				background: row.lightBackgroundColor,
				surface: row.lightSurfaceColor,
				text: row.lightTextColor,
			},
			dark: {
				primary: row.darkPrimaryColor,
				textOnPrimary: row.darkTextOnPrimaryColor,
				background: row.darkBackgroundColor,
				surface: row.darkSurfaceColor,
				text: row.darkTextColor,
			},
			position: row.position,
			theme: row.theme,
			themeToggle: row.themeToggleEnabled,
			// Widened on read: a since-dropped language must not make the row unreadable.
			language: row.language as WidgetAppearance["language"],
		},
	}
}

function toColumns(appearance: WidgetAppearance) {
	return {
		lightPrimaryColor: appearance.light.primary,
		lightTextOnPrimaryColor: appearance.light.textOnPrimary,
		lightBackgroundColor: appearance.light.background,
		lightSurfaceColor: appearance.light.surface,
		lightTextColor: appearance.light.text,
		darkPrimaryColor: appearance.dark.primary,
		darkTextOnPrimaryColor: appearance.dark.textOnPrimary,
		darkBackgroundColor: appearance.dark.background,
		darkSurfaceColor: appearance.dark.surface,
		darkTextColor: appearance.dark.text,
		position: appearance.position,
		theme: appearance.theme,
		themeToggleEnabled: appearance.themeToggle,
		language: appearance.language,
	}
}

export async function listWidgets(agentId?: string): Promise<Widget[]> {
	return (await repo.listWidgets(agentId)).map(toWidget)
}

export async function getWidget(id: string): Promise<Widget> {
	const row = await repo.findWidget(id)
	if (!row) throw new WidgetNotFoundError(`Widget ${id} not found`)
	return toWidget(row)
}

export async function createWidget(input: WidgetInput): Promise<Widget> {
	try {
		const row = await repo.insertWidget({
			id: crypto.randomUUID(),
			agentId: input.agentId,
			name: input.name,
			publicToken: generateOpaqueToken(),
			...toColumns(input.appearance),
		})
		return toWidget(row)
	} catch (error) {
		if (isForeignKeyViolation(error)) throw new UnknownAgentError(`Agent ${input.agentId} not found`)
		throw error
	}
}

export async function updateWidget(id: string, input: WidgetInput): Promise<Widget> {
	try {
		const row = await repo.updateWidget(id, {
			agentId: input.agentId,
			name: input.name,
			...toColumns(input.appearance),
		})
		if (!row) throw new WidgetNotFoundError(`Widget ${id} not found`)
		return toWidget(row)
	} catch (error) {
		if (isForeignKeyViolation(error)) throw new UnknownAgentError("Agent not found")
		throw error
	}
}

export async function deleteWidget(id: string): Promise<void> {
	const row = await repo.findWidget(id)
	if (!row) throw new WidgetNotFoundError(`Widget ${id} not found`)
	await repo.deleteWidget(id)
}

export async function getConfigByToken(publicToken: string): Promise<WidgetConfig> {
	const row = await repo.findWidgetByToken(publicToken)
	if (!row) throw new WidgetNotFoundError("Widget not found")
	const { agentId, name, appearance } = toWidget(row)
	return { version: WIDGET_CONFIG_VERSION, agentId, name, appearance, updatedAt: row.updatedAt }
}
