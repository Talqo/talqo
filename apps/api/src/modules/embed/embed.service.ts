import type { Annotate } from "@/http/wide-event.ts"
import type { AgentPermission } from "@/modules/roles/roles.service.ts"
import type { WidgetAppearance } from "@talqo/shared/widget-appearance"

import { ApiError, PROBLEM_CODES } from "@/http/problem.ts"
import { HTTP_STATUS } from "@/http/status.ts"
import { generateOpaqueToken } from "@/lib/opaque-token.ts"
import { isForeignKeyViolation } from "@/lib/pg-error.ts"
import { uploadAreaDir } from "@/lib/upload-storage.ts"
import * as aiProvider from "@/modules/ai-provider/ai-provider.service.ts"
import * as roles from "@/modules/roles/roles.service.ts"
import { EMBED_ICON_MAX_BYTES, EMBED_ICON_MAX_KB, isSvgDocument } from "@talqo/shared/embed-icon"
import { WIDGET_CONFIG_VERSION } from "@talqo/shared/widget-appearance"
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"

import * as repo from "./embed.repository.ts"

export const EMBED_NAME_MAX_LENGTH = 80

export type Embed = {
	accessVersion: number
	agentId: string
	appearance: WidgetAppearance
	embedToken: string
	iconUrl: string | null
	id: string
	isDisabled: boolean
	name: string
}

export type EmbedConfig = {
	appearance: WidgetAppearance
	iconUrl: string | null
	isAvailable: boolean
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
class InvalidEmbedIconError extends ApiError {
	constructor(message?: string, options?: ErrorOptions) {
		super(PROBLEM_CODES.EMBED_ICON_INVALID, HTTP_STATUS.BAD_REQUEST, message, undefined, options)
	}
}
class EmbedIconNotFoundError extends ApiError {
	constructor(message?: string, options?: ErrorOptions) {
		super(PROBLEM_CODES.EMBED_ICON_NOT_FOUND, HTTP_STATUS.NOT_FOUND, message, undefined, options)
	}
}
class EmbedIconTooLargeError extends ApiError {
	constructor(message?: string, options?: ErrorOptions) {
		super(PROBLEM_CODES.PAYLOAD_TOO_LARGE, HTTP_STATUS.PAYLOAD_TOO_LARGE, message, undefined, options)
	}
}

type EmbedRow = NonNullable<Awaited<ReturnType<typeof repo.findEmbed>>>

/** Relative to the API origin; the version busts caches when the icon is replaced. */
function iconPath(embedToken: string, iconUpdatedAt: Date): string {
	return `/api/embed-config/${encodeURIComponent(embedToken)}/icon?v=${iconUpdatedAt.getTime()}`
}

function toEmbed(row: EmbedRow): Embed {
	return {
		id: row.id,
		agentId: row.agentId,
		name: row.name,
		embedToken: row.embedToken,
		accessVersion: row.accessVersion,
		isDisabled: row.isDisabled,
		iconUrl: row.iconUpdatedAt === null ? null : iconPath(row.embedToken, row.iconUpdatedAt),
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

export async function listVisibleEmbeds(actorId: string, agentId?: string): Promise<Embed[]> {
	const scope = await roles.agentScope(actorId, roles.AgentPermission.AgentRead)
	if (!agentId) return (await repo.listEmbeds(scope)).map(toEmbed)
	const allowed = scope === "all" || scope.includes(agentId)
	return (await repo.listEmbeds(allowed ? [agentId] : [])).map(toEmbed)
}

export async function getEmbed(
	id: string,
	actorId: string,
	permission: AgentPermission = roles.AgentPermission.AgentRead,
): Promise<Embed> {
	const row = await repo.findEmbed(id)
	if (!row) throw new EmbedNotFoundError(`Embed ${id} not found`)
	await roles.requireAgentPermission(actorId, row.agentId, permission, PROBLEM_CODES.EMBED_NOT_FOUND)
	return toEmbed(row)
}

export async function createEmbed(input: EmbedInput, actorId: string): Promise<Embed> {
	await roles.requireAgentPermission(actorId, input.agentId, roles.AgentPermission.AgentManage)
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

export async function updateEmbed(id: string, input: EmbedInput, actorId: string): Promise<Embed> {
	const current = await getEmbed(id, actorId, roles.AgentPermission.AgentManage)
	await roles.requireAgentPermission(actorId, input.agentId, roles.AgentPermission.AgentManage)
	try {
		const row = await repo.updateEmbed(
			id,
			{
				agentId: input.agentId,
				name: input.name,
				...toColumns(input.appearance),
			},
			current.agentId,
		)
		if (!row) throw new EmbedNotFoundError(`Embed ${id} not found`)
		return toEmbed(row)
	} catch (error) {
		if (isForeignKeyViolation(error)) throw new UnknownAgentError("Agent not found")
		throw error
	}
}

export async function rotateEmbedToken(id: string, actorId: string): Promise<Embed> {
	const current = await getEmbed(id, actorId, roles.AgentPermission.AgentManage)
	const row = await repo.rotateEmbedToken(id, generateOpaqueToken(), current.agentId)
	if (!row) throw new EmbedNotFoundError(`Embed ${id} not found`)
	return toEmbed(row)
}

export async function disableEmbed(id: string, actorId: string): Promise<Embed> {
	return setDisabled(id, true, actorId)
}

export async function enableEmbed(id: string, actorId: string): Promise<Embed> {
	return setDisabled(id, false, actorId)
}

async function setDisabled(id: string, isDisabled: boolean, actorId: string): Promise<Embed> {
	const current = await getEmbed(id, actorId, roles.AgentPermission.AgentManage)
	const row = await repo.setEmbedDisabled(id, isDisabled, current.agentId)
	if (!row) throw new EmbedNotFoundError(`Embed ${id} not found`)
	return toEmbed(row)
}

function iconDir(embedId: string): string {
	return join(uploadAreaDir("embeds"), embedId)
}

function iconFile(embedId: string): string {
	return join(iconDir(embedId), "icon.svg")
}

// Written beside the target and renamed over it, so a replacement is never served half-written.
async function writeIconFile(embedId: string, markup: string): Promise<void> {
	await mkdir(iconDir(embedId), { recursive: true })
	const staging = join(iconDir(embedId), `icon.${crypto.randomUUID()}.tmp`)
	try {
		await writeFile(staging, markup, { flag: "wx" })
		await rename(staging, iconFile(embedId))
	} finally {
		await rm(staging, { force: true })
	}
}

async function removeIconDir(embedId: string): Promise<void> {
	await rm(iconDir(embedId), { recursive: true, force: true })
}

function decodeIcon(content: ArrayBuffer): string {
	if (content.byteLength > EMBED_ICON_MAX_BYTES) {
		throw new EmbedIconTooLargeError(`Icon exceeds the ${EMBED_ICON_MAX_KB} KB size limit`)
	}
	let markup: string
	try {
		markup = new TextDecoder("utf-8", { fatal: true }).decode(content)
	} catch {
		throw new InvalidEmbedIconError("Icon is not UTF-8 text")
	}
	if (!isSvgDocument(markup)) throw new InvalidEmbedIconError("Icon must be an SVG document")
	return markup
}

// File first, then the column: a crash in between leaves at most an unreferenced file.
export async function setEmbedIcon(id: string, content: ArrayBuffer, actorId: string): Promise<Embed> {
	const markup = decodeIcon(content)
	const current = await getEmbed(id, actorId, roles.AgentPermission.AgentManage)
	await writeIconFile(id, markup)
	const row = await repo.setEmbedIconUpdatedAt(id, new Date(), current.agentId)
	if (!row) {
		await removeIconDir(id)
		throw new EmbedNotFoundError(`Embed ${id} not found`)
	}
	return toEmbed(row)
}

// Column first, then the file: the public URL disappears before the file it points at.
export async function removeEmbedIcon(id: string, actorId: string): Promise<Embed> {
	const current = await getEmbed(id, actorId, roles.AgentPermission.AgentManage)
	const row = await repo.setEmbedIconUpdatedAt(id, null, current.agentId)
	if (!row) throw new EmbedNotFoundError(`Embed ${id} not found`)
	await removeIconDir(id)
	return toEmbed(row)
}

export async function getIconByToken(embedToken: string): Promise<{ content: Uint8Array; updatedAt: Date }> {
	const row = await repo.findEmbedByToken(embedToken)
	if (!row?.iconUpdatedAt) throw new EmbedIconNotFoundError("Embed icon not found")
	try {
		return { content: await readFile(iconFile(row.id)), updatedAt: row.iconUpdatedAt }
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new EmbedIconNotFoundError("Embed icon not found")
		throw error
	}
}

/** Removes icon directories left by an embed deletion that crashed before its file cleanup. */
export async function removeOrphanIcons(): Promise<void> {
	let embedIds: string[]
	try {
		embedIds = await readdir(uploadAreaDir("embeds"))
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return
		throw error
	}
	// Directories are listed before rows are read, so an icon uploaded meanwhile is never mistaken for an orphan.
	const existing = await repo.findExistingEmbedIds(embedIds)
	const orphans = embedIds.filter((embedId) => !existing.has(embedId))
	await Promise.all(orphans.map(removeIconDir))
	if (orphans.length > 0) console.info("embed.icons.orphans_removed", { removed: orphans.length })
}

export async function deleteEmbed(id: string, actorId: string): Promise<void> {
	const current = await getEmbed(id, actorId, roles.AgentPermission.AgentManage)
	if (!(await repo.deleteEmbed(id, current.agentId))) throw new EmbedNotFoundError(`Embed ${id} not found`)
	// After the row: a crash here leaves an orphan directory that the startup sweep removes.
	await removeIconDir(id)
}

export async function getConfigByToken(embedToken: string, annotate: Annotate = () => {}): Promise<EmbedConfig> {
	const row = await repo.findEmbedByToken(embedToken)
	if (!row) throw new EmbedNotFoundError("Embed not found")
	annotate({ "embed.id": row.id, "agent.id": row.agentId })
	const { name, appearance, iconUrl, isDisabled } = toEmbed(row)
	const isAvailable = !isDisabled && (await aiProvider.canGenerateText())
	return { version: WIDGET_CONFIG_VERSION, name, appearance, iconUrl, isAvailable, updatedAt: row.updatedAt }
}

export async function getEmbedByToken(embedToken: string): Promise<Embed> {
	const row = await repo.findEmbedByToken(embedToken)
	if (!row) throw new EmbedNotFoundError("Embed not found")
	return toEmbed(row)
}
