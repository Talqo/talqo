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
			primary: row.primaryColor,
			primaryForeground: row.primaryForegroundColor,
			background: row.backgroundColor,
			foreground: row.foregroundColor,
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
		primaryColor: appearance.primary,
		primaryForegroundColor: appearance.primaryForeground,
		backgroundColor: appearance.background,
		foregroundColor: appearance.foreground,
		position: appearance.position,
		theme: appearance.theme,
		themeToggleEnabled: appearance.themeToggle,
		language: appearance.language,
	}
}

export async function listWidgets(): Promise<Widget[]> {
	return (await repo.listWidgets()).map(toWidget)
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
	const { agentId, appearance } = toWidget(row)
	return { version: WIDGET_CONFIG_VERSION, agentId, appearance, updatedAt: row.updatedAt }
}
