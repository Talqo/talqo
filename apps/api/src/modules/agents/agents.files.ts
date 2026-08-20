import { env } from "@/config/env.ts"
import { constants as fsConstants } from "node:fs"
import { copyFile, mkdir, readdir, rm, stat, unlink, writeFile } from "node:fs/promises"
import { join } from "node:path"

// Filename must be safe to use directly on disk: no separators or control characters.
const FORBIDDEN_NAME_CHARS = /[/\\\0]|\.{2}/

export type StoredFile = {
	name: string
	sizeBytes: number
	createdAt: Date
}

export class FileExistsError extends Error {}
export class FileNotFoundError extends Error {}
export class InvalidNameError extends Error {}

export function validateName(name: string): void {
	if (!name || FORBIDDEN_NAME_CHARS.test(name)) {
		throw new InvalidNameError(`File name ${name || '"(empty)"'} contains forbidden characters`)
	}
	if (name.length > env.TALQO_MAX_FILE_NAME_LENGTH) {
		throw new InvalidNameError(`File name exceeds the ${env.TALQO_MAX_FILE_NAME_LENGTH} character limit`)
	}
}

function agentDir(agentId: string): string {
	return join(env.TALQO_UPLOAD_DIR, agentId)
}

function buildFile(name: string, stats: { size: number; birthtime: Date; mtime: Date }): StoredFile {
	// birthtime is unreliable on some filesystems; fall back to mtime.
	const createdAt = stats.birthtime.getTime() === 0 ? stats.mtime : stats.birthtime
	return { name, sizeBytes: stats.size, createdAt }
}

export async function list(agentId: string): Promise<StoredFile[]> {
	const dir = agentDir(agentId)
	let entries: string[]
	try {
		entries = await readdir(dir)
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return []
		throw error
	}
	const files = await Promise.all(entries.map(async (name) => buildFile(name, await stat(join(dir, name)))))
	return files.toSorted((a, b) => a.name.localeCompare(b.name))
}

export async function put(agentId: string, name: string, data: ArrayBuffer): Promise<StoredFile> {
	const dir = agentDir(agentId)
	await mkdir(dir, { recursive: true })
	const path = join(dir, name)
	try {
		// wx fails if the file already exists: names are unique per agent directory.
		await writeFile(path, Buffer.from(data), { flag: "wx" })
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new FileExistsError(`File ${name} already exists`)
		throw error
	}
	return buildFile(name, await stat(path))
}

// COPYFILE_EXCL must succeed before removing the source: otherwise renaming to an existing name would clobber it.
export async function renameFile(agentId: string, oldName: string, newName: string): Promise<StoredFile> {
	const dir = agentDir(agentId)
	const source = join(dir, oldName)
	const target = join(dir, newName)
	try {
		await copyFile(source, target, fsConstants.COPYFILE_EXCL)
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code
		if (code === "EEXIST") throw new FileExistsError(`File ${newName} already exists`)
		if (code === "ENOENT") throw new FileNotFoundError(`File ${oldName} not found`)
		throw error
	}
	await unlink(source)
	return buildFile(newName, await stat(target))
}

export async function remove(agentId: string, name: string): Promise<void> {
	try {
		await unlink(join(agentDir(agentId), name))
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new FileNotFoundError(`File ${name} not found`)
		throw error
	}
}

export async function removeAgentDir(agentId: string): Promise<void> {
	await rm(agentDir(agentId), { force: true, recursive: true })
}
