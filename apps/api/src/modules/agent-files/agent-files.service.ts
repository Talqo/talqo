import { env } from "@/config/env.ts"
import { constants as fsConstants } from "node:fs"
import { copyFile, mkdir, readdir, rm, stat, unlink, writeFile } from "node:fs/promises"
import { extname, join } from "node:path"
import { z } from "zod"

/* eslint-disable no-magic-numbers */
export const MAX_FILE_SIZE_MB = 10
export const BYTES_PER_MB = 1024 * 1024
// 255 keeps file names portable across filesystems and cheap to validate.
export const MAX_FILE_NAME_LENGTH = 255
// One MB covers multipart framing around the raw file body so the route body limit rejects oversized uploads.
export const MULTIPART_MARGIN_BYTES = 1024 * 1024
/* eslint-enable no-magic-numbers */

export const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * BYTES_PER_MB
export const MAX_UPLOAD_BODY_BYTES = MAX_FILE_SIZE_BYTES + MULTIPART_MARGIN_BYTES

// Client-declared MIME types are not trustworthy (sniffed text becomes text/plain), so validate by extension.
export const ALLOWED_EXTENSIONS = [".docx", ".md", ".pdf", ".txt"] as const
const ALLOWED_EXTENSION_SET: ReadonlySet<string> = new Set(ALLOWED_EXTENSIONS)

const FORBIDDEN_NAME_CHARS = /[/\\\0]|\.{2}/

const fileNameSchema = z
	.string()
	.min(1, "File name must not be empty")
	.max(MAX_FILE_NAME_LENGTH, `File name exceeds the ${MAX_FILE_NAME_LENGTH} character limit`)
	.refine((name) => !FORBIDDEN_NAME_CHARS.test(name), "File name contains forbidden characters")

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

export function validateName(name: string): void {
	const result = fileNameSchema.safeParse(name)
	if (!result.success) throw new InvalidFileError(z.prettifyError(result.error))
}

export function validateUpload(file: { name: string; size: number }): void {
	const ext = extname(file.name).toLowerCase()
	if (!ALLOWED_EXTENSION_SET.has(ext)) {
		const allowed = ALLOWED_EXTENSIONS.map((extension) => extension.slice(1).toUpperCase()).join(", ")
		throw new InvalidFileError(`File type ${ext || "(none)"} is not allowed; use ${allowed}`)
	}
	validateName(file.name)
	if (file.size > MAX_FILE_SIZE_BYTES) {
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
		await writeFile(path, new Uint8Array(data), { flag: "wx" })
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
	if (newName === oldName) {
		// No-op rename answers 200; COPYFILE_EXCL would fail EEXIST on the same path.
		try {
			return buildFile(newName, await stat(source))
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new FileNotFoundError(`File ${oldName} not found`)
			throw error
		}
	}
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
