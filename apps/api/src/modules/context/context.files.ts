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
export class ContextNotFoundError extends Error {}
export class InvalidNameError extends Error {}

export function validateName(name: string): void {
	if (!name || FORBIDDEN_NAME_CHARS.test(name)) {
		throw new InvalidNameError(`File name ${name || '"(empty)"'} contains forbidden characters`)
	}
	if (name.length > env.TALQO_MAX_FILE_NAME_LENGTH) {
		throw new InvalidNameError(`File name exceeds the ${env.TALQO_MAX_FILE_NAME_LENGTH} character limit`)
	}
}

function contextDir(contextId: string): string {
	return join(env.TALQO_UPLOAD_DIR, contextId)
}

function buildFile(name: string, stats: { size: number; birthtime: Date; mtime: Date }): StoredFile {
	// birthtime is unreliable on some filesystems; fall back to mtime.
	const createdAt = stats.birthtime.getTime() === 0 ? stats.mtime : stats.birthtime
	return { name, sizeBytes: stats.size, createdAt }
}

// A context id is unguessable (UUID), but check existence on every access anyway:
// once a directory is deleted (context retired, manual cleanup) requests must 404, not resurrect it.
export async function exists(contextId: string): Promise<boolean> {
	try {
		const s = await stat(contextDir(contextId))
		return s.isDirectory()
	} catch {
		return false
	}
}

export async function requireContext(contextId: string): Promise<void> {
	if (!(await exists(contextId))) throw new ContextNotFoundError(`Context ${contextId} not found`)
}

export async function create(contextId: string): Promise<void> {
	await mkdir(contextDir(contextId), { recursive: true })
}

export async function list(contextId: string): Promise<StoredFile[]> {
	const dir = contextDir(contextId)
	const entries = await readdir(dir) // throws ENOENT if the dir is gone: caller's requireContext already checks
	const files = await Promise.all(entries.map(async (name) => buildFile(name, await stat(join(dir, name)))))
	return files.toSorted((a, b) => a.name.localeCompare(b.name))
}

export async function put(contextId: string, name: string, data: ArrayBuffer): Promise<StoredFile> {
	const dir = contextDir(contextId)
	const path = join(dir, name)
	try {
		// wx fails if the file already exists: names are unique per context directory.
		await writeFile(path, Buffer.from(data), { flag: "wx" })
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new FileExistsError(`File ${name} already exists`)
		throw error
	}
	return buildFile(name, await stat(path))
}

// COPYFILE_EXCL must succeed before removing the source: otherwise renaming to an existing name would clobber it.
export async function renameFile(contextId: string, oldName: string, newName: string): Promise<StoredFile> {
	const dir = contextDir(contextId)
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

export async function remove(contextId: string, name: string): Promise<void> {
	try {
		await unlink(join(contextDir(contextId), name))
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new FileNotFoundError(`File ${name} not found`)
		throw error
	}
}

export async function removeContextDir(contextId: string): Promise<void> {
	await rm(contextDir(contextId), { force: true, recursive: true })
}
