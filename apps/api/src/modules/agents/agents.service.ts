import { env } from "@/config/env.ts"
import { mkdir, unlink } from "node:fs/promises"
import { extname, join } from "node:path"

import type { Agent, AgentFile } from "./agents.repository.ts"

import * as repo from "./agents.repository.ts"

// eslint-disable-next-line no-magic-numbers
export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024

// Extension allowlist. The client-declared MIME type is stored for future serving but NOT
// used for validation: browsers label sniffed text content as text/plain regardless of the
// real type, and Bun's multipart parsing infers the type from content anyway.
export const ALLOWED_EXTENSIONS = [".pdf", ".txt", ".md", ".docx"]

export class AgentNotFoundError extends Error {}
export class AgentFileNotFoundError extends Error {}
export class InvalidFileError extends Error {}

export type PublicAgent = {
	id: string
	name: string
	systemPrompt: string
	wordBlacklist: string[]
	status: "active" | "paused"
	avatarUrl: null
}

export type PublicAgentFile = Pick<AgentFile, "createdAt" | "id" | "mimeType" | "sizeBytes"> & {
	name: string
}

export function toPublicAgent(agent: Agent): PublicAgent {
	return {
		id: agent.id,
		name: agent.name,
		systemPrompt: agent.systemPrompt,
		wordBlacklist: agent.wordBlacklist,
		status: agent.active ? "active" : "paused",
		avatarUrl: null,
	}
}

function toPublicAgentFile(file: AgentFile): PublicAgentFile {
	return {
		id: file.id,
		name: file.originalName,
		mimeType: file.mimeType,
		sizeBytes: file.sizeBytes,
		createdAt: file.createdAt,
	}
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
	const files = await repo.listAgentFiles(id)
	await repo.deleteAgent(id, ownerId)
	await Promise.all(files.map((file) => deleteFromDisk(file.storedName)))
}

export async function listFiles(agentId: string, ownerId: string): Promise<PublicAgentFile[]> {
	await requireOwnedAgent(agentId, ownerId)
	const files = await repo.listAgentFiles(agentId)
	return files.map(toPublicAgentFile)
}

export async function uploadFile(
	agentId: string,
	ownerId: string,
	file: { name: string; size: number; type: string; arrayBuffer: () => Promise<ArrayBuffer> },
): Promise<PublicAgentFile> {
	await requireOwnedAgent(agentId, ownerId)
	validateFile(file)

	const ext = extname(file.name).toLowerCase()
	const storedName = `${crypto.randomUUID()}${ext}`
	await mkdir(env.TALQO_UPLOAD_DIR, { recursive: true })
	await Bun.write(join(env.TALQO_UPLOAD_DIR, storedName), await file.arrayBuffer())

	try {
		const row = await repo.insertAgentFile({
			id: crypto.randomUUID(),
			agentId,
			originalName: file.name,
			storedName,
			mimeType: file.type.split(";")[0]?.trim() || file.type,
			sizeBytes: file.size,
		})
		return toPublicAgentFile(row)
	} catch (error) {
		await deleteFromDisk(storedName)
		throw error
	}
}

export async function deleteFile(agentId: string, fileId: string, ownerId: string): Promise<void> {
	await requireOwnedAgent(agentId, ownerId)
	const file = await repo.findAgentFileById(fileId, agentId)
	if (!file) throw new AgentFileNotFoundError(`File ${fileId} not found`)
	await repo.deleteAgentFile(fileId)
	await deleteFromDisk(file.storedName)
}

// Renaming edits only the display name (original_name); the stored file on disk is untouched.
export async function renameFile(
	agentId: string,
	fileId: string,
	ownerId: string,
	name: string,
): Promise<PublicAgentFile> {
	await requireOwnedAgent(agentId, ownerId)
	const trimmed = name.trim()
	if (!trimmed) throw new InvalidFileError("File name must not be empty")
	const file = await repo.findAgentFileById(fileId, agentId)
	if (!file) throw new AgentFileNotFoundError(`File ${fileId} not found`)
	const ext = extname(file.originalName).toLowerCase()
	const updated = await repo.updateAgentFileName(
		fileId,
		agentId,
		trimmed.toLowerCase().endsWith(ext) ? trimmed : `${trimmed}${ext}`,
	)
	if (!updated) throw new AgentFileNotFoundError(`File ${fileId} not found`)
	return toPublicAgentFile(updated)
}

function validateFile(file: { name: string; size: number; type: string }): void {
	const ext = extname(file.name).toLowerCase()
	if (!ALLOWED_EXTENSIONS.includes(ext)) {
		throw new InvalidFileError(`File type ${ext || "(none)"} is not allowed; use PDF, TXT, MD, or DOCX`)
	}
	if (file.size > MAX_FILE_SIZE_BYTES) {
		throw new InvalidFileError("File exceeds the 10 MB size limit")
	}
}

async function deleteFromDisk(storedName: string): Promise<void> {
	try {
		await unlink(join(env.TALQO_UPLOAD_DIR, storedName))
	} catch {
		// Best-effort cleanup: the DB row is gone, a stray file on disk is acceptable.
	}
}
