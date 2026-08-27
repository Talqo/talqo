import { env } from "@/config/env.ts"
import { constants as fsConstants } from "node:fs"
import { copyFile, mkdir, readdir, rm, stat, unlink, writeFile } from "node:fs/promises"
import { extname, join } from "node:path"

/* eslint-disable no-magic-numbers */
export const MAX_FILE_SIZE_MB = 10
export const BYTES_PER_MB = 1024 * 1024
// 255 keeps file names portable across filesystems and cheap to validate.
export const MAX_FILE_NAME_LENGTH = 255
/* eslint-enable no-magic-numbers */

// Extension allowlist. The client-declared MIME type is NOT trustworthy for validation:
// browsers label sniffed text content as text/plain regardless of the real type.
const ALLOWED_EXTENSIONS = new Set([".pdf", ".txt", ".md", ".docx"])

// Filename must be safe to use directly on disk: no separators or control characters.
const FORBIDDEN_NAME_CHARS = /[/\\\0]|\.{2}/

export type StoredFile = {
	name: string
	sizeBytes: number
	createdAt: Date
}

export class FileExistsError extends Error {}
export class FileNotFoundError extends Error {}
export class InvalidFileError extends Error {}

function agentDir(agentId: string): string {
	return join(env.TALQO_UPLOAD_DIR, agentId)
}

function buildFile(name: string, stats: { size: number; birthtime: Date; mtime: Date }): StoredFile {
	// birthtime is unreliable on some filesystems; fall back to mtime.
	const createdAt = stats.birthtime.getTime() === 0 ? stats.mtime : stats.birthtime
	return { name, sizeBytes: stats.size, createdAt }
}

function validateName(name: string): void {
	if (!name || FORBIDDEN_NAME_CHARS.test(name)) {
		throw new InvalidFileError(`File name ${name || '"(empty)"'} contains forbidden characters`)
	}
	if (name.length > MAX_FILE_NAME_LENGTH) {
		throw new InvalidFileError(`File name exceeds the ${MAX_FILE_NAME_LENGTH} character limit`)
	}
}

export function validateUpload(file: { name: string; size: number }): void {
	const ext = extname(file.name).toLowerCase()
	if (!ALLOWED_EXTENSIONS.has(ext)) {
		throw new InvalidFileError(`File type ${ext || "(none)"} is not allowed; use PDF, TXT, MD, or DOCX`)
	}
	validateName(file.name)
	if (file.size > MAX_FILE_SIZE_MB * BYTES_PER_MB) {
		throw new InvalidFileError(`File exceeds the ${MAX_FILE_SIZE_MB} MB size limit`)
	}
}

// Resolve a rename target: empty → error, keep the original extension, then validate.
export function resolveRenameTarget(name: string, requested: string): string {
	const trimmed = requested.trim()
	if (!trimmed) throw new InvalidFileError("File name must not be empty")
	const ext = extname(name).toLowerCase()
	const target = trimmed.toLowerCase().endsWith(ext) ? trimmed : `${trimmed}${ext}`
	validateName(target)
	return target
}

export function validatePathName(name: string): void {
	validateName(name)
}

export async function list(agentId: string): Promise<StoredFile[]> {
	const dir = agentDir(agentId)
	let entries: string[]
	try {
		entries = await readdir(dir)
	} catch (error) {
		// No upload yet: the directory simply does not exist, which is "no files".
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return []
		throw error
	}
	const files = await Promise.all(entries.map(async (name) => buildFile(name, await stat(join(dir, name)))))
	return files.toSorted((a, b) => a.name.localeCompare(b.name))
}

export async function put(agentId: string, name: string, data: ArrayBuffer): Promise<StoredFile> {
	const dir = agentDir(agentId)
	// The agent directory is created lazily on the first upload.
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
