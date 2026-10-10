import type { WidgetAppearance } from "@talqo/shared/widget-appearance"

import { ApiError, PROBLEM_CODES } from "@/http/problem.ts"
import { HTTP_STATUS } from "@/http/status.ts"
import { generateOpaqueToken } from "@/lib/opaque-token.ts"
import { isForeignKeyViolation } from "@/lib/pg-error.ts"
import { WIDGET_CONFIG_VERSION } from "@talqo/shared/widget-appearance"

import * as repo from "./embed.repository.ts"

export const EMBED_NAME_MAX_LENGTH = 80

export type Embed = {
	accessVersion: number
	agentId: string
	appearance: WidgetAppearance
	embedToken: string
	id: string
	isDisabled: boolean
	name: string
}

export type EmbedConfig = {
	appearance: WidgetAppearance
	isDisabled: boolean
	name: string
	updatedAt: Date
	version: number
}

export type EmbedInput = {
	agentId: string
	appearance: WidgetAppearance
	name: string
}

export class EmbedNotFoundError extends ApiError {
	constructor(message?: string, options?: ErrorOptions) {
		super(PROBLEM_CODES.EMBED_NOT_FOUND, HTTP_STATUS.NOT_FOUND, message, undefined, options)
	}
}
export class UnknownAgentError extends ApiError {
	constructor(message?: string, options?: ErrorOptions) {
		super(PROBLEM_CODES.AGENT_NOT_FOUND, HTTP_STATUS.NOT_FOUND, message, undefined, options)
	}
}

type EmbedRow = NonNullable<Awaited<ReturnType<typeof repo.findEmbed>>>

function toEmbed(row: EmbedRow): Embed {
	return {
		id: row.id,
		agentId: row.agentId,
		name: row.name,
		embedToken: row.embedToken,
		accessVersion: row.accessVersion,
		isDisabled: row.isDisabled,
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

export async function listEmbeds(agentId?: string): Promise<Embed[]> {
	return (await repo.listEmbeds(agentId)).map(toEmbed)
}

export async function getEmbed(id: string): Promise<Embed> {
	const row = await repo.findEmbed(id)
	if (!row) throw new EmbedNotFoundError(`Embed ${id} not found`)
	return toEmbed(row)
}

export async function createEmbed(input: EmbedInput): Promise<Embed> {
	try {
		const row = await repo.insertEmbed({
			id: crypto.randomUUID(),
			agentId: input.agentId,
			name: input.name,
			embedToken: generateOpaqueToken(),
			...toColumns(input.appearance),
		})
		return toEmbed(row)
	} catch (error) {
		if (isForeignKeyViolation(error)) throw new UnknownAgentError(`Agent ${input.agentId} not found`)
		throw error
	}
}

export async function updateEmbed(id: string, input: EmbedInput): Promise<Embed> {
	try {
		const row = await repo.updateEmbed(id, {
			agentId: input.agentId,
			name: input.name,
			...toColumns(input.appearance),
		})
		if (!row) throw new EmbedNotFoundError(`Embed ${id} not found`)
		return toEmbed(row)
	} catch (error) {
		if (isForeignKeyViolation(error)) throw new UnknownAgentError("Agent not found")
		throw error
	}
}

export async function rotateEmbedToken(id: string): Promise<Embed> {
	const row = await repo.rotateEmbedToken(id, generateOpaqueToken())
	if (!row) throw new EmbedNotFoundError(`Embed ${id} not found`)
	return toEmbed(row)
}

export async function disableEmbed(id: string): Promise<Embed> {
	return setDisabled(id, true)
}

export async function enableEmbed(id: string): Promise<Embed> {
	return setDisabled(id, false)
}

async function setDisabled(id: string, isDisabled: boolean): Promise<Embed> {
	const row = await repo.setEmbedDisabled(id, isDisabled)
	if (!row) throw new EmbedNotFoundError(`Embed ${id} not found`)
	return toEmbed(row)
}

export async function deleteEmbed(id: string): Promise<void> {
	const row = await repo.findEmbed(id)
	if (!row) throw new EmbedNotFoundError(`Embed ${id} not found`)
	await repo.deleteEmbed(id)
}

export async function getConfigByToken(embedToken: string): Promise<EmbedConfig> {
	const row = await repo.findEmbedByToken(embedToken)
	if (!row) throw new EmbedNotFoundError("Embed not found")
	const { name, appearance, isDisabled } = toEmbed(row)
	return { version: WIDGET_CONFIG_VERSION, name, appearance, isDisabled, updatedAt: row.updatedAt }
}

export async function getEmbedByToken(embedToken: string): Promise<Embed> {
	const row = await repo.findEmbedByToken(embedToken)
	if (!row) throw new EmbedNotFoundError("Embed not found")
	return toEmbed(row)
}
