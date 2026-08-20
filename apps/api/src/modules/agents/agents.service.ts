import { BYTES_PER_MB, env } from "@/config/env.ts"
import { extname } from "node:path"

import type { StoredFile } from "./agents.files.ts"
import type { Agent } from "./agents.repository.ts"

import * as files from "./agents.files.ts"
import * as repo from "./agents.repository.ts"

// Extension allowlist. The client-declared MIME type is NOT trustworthy for validation:
// browsers label sniffed text content as text/plain regardless of the real type.
export const ALLOWED_EXTENSIONS = [".pdf", ".txt", ".md", ".docx"]

export class AgentNotFoundError extends Error {}
export class InvalidFileError extends Error {}

export type PublicAgent = {
	id: string
	name: string
	systemPrompt: string
	wordBlacklist: string[]
	status: "active" | "paused"
}

export type PublicAgentFile = {
	name: string
	sizeBytes: number
	createdAt: Date
}

export function toPublicAgent(agent: Agent): PublicAgent {
	return {
		id: agent.id,
		name: agent.name,
		systemPrompt: agent.systemPrompt,
		wordBlacklist: agent.wordBlacklist,
		status: agent.active ? "active" : "paused",
	}
}

function toPublicAgentFile(file: StoredFile): PublicAgentFile {
	return { name: file.name, sizeBytes: file.sizeBytes, createdAt: file.createdAt }
}

export async function listAgents(ownerId: string): Promise<PublicAgent[]> {
	const agents = await repo.listAgentsByOwner(ownerId)
	return agents.map(toPublicAgent)
}

export async function createAgent(ownerId: string, input: { name: string }): Promise<PublicAgent> {
	const agent = await repo.insertAgent({ id: crypto.randomUUID(), ownerId, name: input.name.trim() })
	return toPublicAgent(agent)
}

async function requireOwnedAgent(id: string, ownerId: string): Promise<Agent> {
	const agent = await repo.findAgentByIdAndOwner(id, ownerId)
	if (!agent) throw new AgentNotFoundError(`Agent ${id} not found`)
	return agent
}

export async function getAgent(id: string, ownerId: string): Promise<PublicAgent> {
	return toPublicAgent(await requireOwnedAgent(id, ownerId))
}

export async function updateAgent(
	id: string,
	ownerId: string,
	input: Partial<{ active: boolean; name: string; systemPrompt: string; wordBlacklist: string[] }>,
): Promise<PublicAgent> {
	await requireOwnedAgent(id, ownerId)
	const values: Parameters<typeof repo.updateAgent>[2] = { ...input }
	if (input.name !== undefined) values.name = input.name.trim()
	const agent = await repo.updateAgent(id, ownerId, values)
	if (!agent) throw new AgentNotFoundError(`Agent ${id} not found`)
	return toPublicAgent(agent)
}

export async function deleteAgent(id: string, ownerId: string): Promise<void> {
	await requireOwnedAgent(id, ownerId)
	await repo.deleteAgent(id, ownerId)
	await files.removeAgentDir(id)
}

export async function listFiles(
	agentId: string,
	ownerId: string,
): Promise<{ files: PublicAgentFile[]; maxNameLength: number; maxSizeBytes: number }> {
	await requireOwnedAgent(agentId, ownerId)
	return {
		files: (await files.list(agentId)).map(toPublicAgentFile),
		maxSizeBytes: env.TALQO_MAX_FILE_SIZE_MB * BYTES_PER_MB,
		maxNameLength: env.TALQO_MAX_FILE_NAME_LENGTH,
	}
}

export async function uploadFile(
	agentId: string,
	ownerId: string,
	file: { name: string; size: number; arrayBuffer: () => Promise<ArrayBuffer> },
): Promise<PublicAgentFile> {
	await requireOwnedAgent(agentId, ownerId)
	validateUpload(file)
	const stored = await files.put(agentId, file.name, await file.arrayBuffer())
	return toPublicAgentFile(stored)
}

export async function deleteFile(agentId: string, name: string, ownerId: string): Promise<void> {
	await requireOwnedAgent(agentId, ownerId)
	await files.remove(agentId, name)
}

// Renaming moves the file on disk; the extension is kept to preserve the validated type.
export async function renameFile(
	agentId: string,
	name: string,
	ownerId: string,
	newName: string,
): Promise<PublicAgentFile> {
	await requireOwnedAgent(agentId, ownerId)
	const trimmed = newName.trim()
	if (!trimmed) throw new InvalidFileError("File name must not be empty")
	const ext = extname(name).toLowerCase()
	const target = trimmed.toLowerCase().endsWith(ext) ? trimmed : `${trimmed}${ext}`
	validateNameForDisk(target)
	const renamed = await files.renameFile(agentId, name, target)
	return toPublicAgentFile(renamed)
}

function validateUpload(file: { name: string; size: number }): void {
	const ext = extname(file.name).toLowerCase()
	if (!ALLOWED_EXTENSIONS.includes(ext)) {
		throw new InvalidFileError(`File type ${ext || "(none)"} is not allowed; use PDF, TXT, MD, or DOCX`)
	}
	validateNameForDisk(file.name)
	if (file.size > env.TALQO_MAX_FILE_SIZE_MB * BYTES_PER_MB) {
		throw new InvalidFileError(`File exceeds the ${env.TALQO_MAX_FILE_SIZE_MB} MB size limit`)
	}
}

function validateNameForDisk(name: string): void {
	try {
		files.validateName(name)
	} catch (error) {
		throw new InvalidFileError((error as Error).message)
	}
}
