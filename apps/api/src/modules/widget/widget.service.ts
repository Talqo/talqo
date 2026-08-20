import { generateOpaqueToken } from "@/lib/opaque-token.ts"
import { isForeignKeyViolation } from "@/lib/pg-error.ts"
import { DEFAULT_WIDGET_APPEARANCE, type WidgetAppearance } from "@talqo/shared/widget-appearance"

import * as repo from "./widget.repository.ts"

export const WIDGET_NAME_MAX_LENGTH = 80

/**
 * Exempted from authentication in `http/require-auth.ts`. Anchored at both ends with
 * a single non-slash segment so it cannot widen into a sibling path; kept separate
 * from the authenticated `/api/widgets` namespace so a prefix mistake here can never
 * expose the CRUD routes.
 */
export const PUBLIC_PATH_PATTERNS = [/^\/api\/widget-config\/[^/]+$/] as const

export const WIDGET_CONFIG_VERSION = 1

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
			// Widened on read: a language removed from `@talqo/shared` after a widget was
			// saved must not make the row unreadable -- the widget falls back on its own.
			language: row.language as WidgetAppearance["language"],
		},
	}
}

function toColumns(appearance: Partial<WidgetAppearance>) {
	return {
		...(appearance.primary !== undefined && { primaryColor: appearance.primary }),
		...(appearance.primaryForeground !== undefined && { primaryForegroundColor: appearance.primaryForeground }),
		...(appearance.background !== undefined && { backgroundColor: appearance.background }),
		...(appearance.foreground !== undefined && { foregroundColor: appearance.foreground }),
		...(appearance.position !== undefined && { position: appearance.position }),
		...(appearance.theme !== undefined && { theme: appearance.theme }),
		...(appearance.themeToggle !== undefined && { themeToggleEnabled: appearance.themeToggle }),
		...(appearance.language !== undefined && { language: appearance.language }),
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

export async function createWidget(input: {
	agentId: string
	appearance?: Partial<WidgetAppearance>
	name: string
}): Promise<Widget> {
	const appearance = { ...DEFAULT_WIDGET_APPEARANCE, ...input.appearance }
	try {
		const row = await repo.insertWidget({
			id: crypto.randomUUID(),
			agentId: input.agentId,
			name: input.name,
			publicToken: generateOpaqueToken(),
			primaryColor: appearance.primary,
			primaryForegroundColor: appearance.primaryForeground,
			backgroundColor: appearance.background,
			foregroundColor: appearance.foreground,
			position: appearance.position,
			theme: appearance.theme,
			themeToggleEnabled: appearance.themeToggle,
			language: appearance.language,
		})
		return toWidget(row)
	} catch (error) {
		if (isForeignKeyViolation(error)) throw new UnknownAgentError(`Agent ${input.agentId} not found`)
		throw error
	}
}

export async function updateWidget(
	id: string,
	patch: { agentId?: string; appearance?: Partial<WidgetAppearance>; name?: string },
): Promise<Widget> {
	const columns = {
		...(patch.agentId !== undefined && { agentId: patch.agentId }),
		...(patch.name !== undefined && { name: patch.name }),
		...toColumns(patch.appearance ?? {}),
	}
	// An empty patch must still confirm the widget exists rather than silently succeeding.
	if (Object.keys(columns).length === 0) return getWidget(id)

	try {
		const row = await repo.updateWidget(id, columns)
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

/** Public read path: everything an embedded widget needs, and nothing else. */
export async function getConfigByToken(publicToken: string): Promise<WidgetConfig> {
	const row = await repo.findWidgetByToken(publicToken)
	if (!row) throw new WidgetNotFoundError("Widget not found")
	const { agentId, appearance } = toWidget(row)
	return { version: WIDGET_CONFIG_VERSION, agentId, appearance, updatedAt: row.updatedAt }
}
