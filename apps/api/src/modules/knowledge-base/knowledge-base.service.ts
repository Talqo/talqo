import { env } from "@/config/env.ts"
import { isForeignKeyViolation } from "@/lib/pg-error.ts"
import * as aiProvider from "@/modules/ai-provider/ai-provider.service.ts"
import { constants as fsConstants } from "node:fs"
import { copyFile, mkdir, readdir, readFile, rm, stat, unlink, writeFile } from "node:fs/promises"
import { extname, join } from "node:path"
import { z } from "zod"

import { chunkFile } from "./docling-client.ts"
import * as repository from "./knowledge-base.repository.ts"
import { IngestionError, processPendingFiles } from "./knowledge-base.worker.ts"

/* eslint-disable no-magic-numbers */
export const MAX_FILE_SIZE_MB = 10
export const BYTES_PER_MB = 1024 * 1024
export const MAX_FILE_NAME_LENGTH = 255
const MULTIPART_MARGIN_BYTES = 1024 * 1024
/* eslint-enable no-magic-numbers */

export const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * BYTES_PER_MB
export const MAX_UPLOAD_BODY_BYTES = MAX_FILE_SIZE_BYTES + MULTIPART_MARGIN_BYTES

export const ALLOWED_EXTENSIONS = [".docx", ".md", ".pdf", ".txt"] as const
const ALLOWED_EXTENSION_SET: ReadonlySet<string> = new Set(ALLOWED_EXTENSIONS)

const FORBIDDEN_NAME_CHARS = /[/\\\0]|\.{2}/

const fileNameSchema = z
	.string()
	.min(1, "File name must not be empty")
	.max(MAX_FILE_NAME_LENGTH, `File name exceeds the ${MAX_FILE_NAME_LENGTH} character limit`)
	.refine((name) => !FORBIDDEN_NAME_CHARS.test(name), "File name contains forbidden characters")
	.refine(
		(name) => Buffer.byteLength(name, "utf8") <= MAX_FILE_NAME_LENGTH,
		`File name exceeds the ${MAX_FILE_NAME_LENGTH} byte limit`,
	)

type StoredFile = {
	name: string
	sizeBytes: number
	createdAt: Date
}
export type IndexedFile = StoredFile & {
	embeddingStatus: repository.FileStatus
	embeddingError: repository.FailureReason | null
}

export class FileExistsError extends Error {}
export class FileNotFoundError extends Error {}
export class InvalidFileError extends Error {}
export class FileTooLargeError extends InvalidFileError {}

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
		throw new FileTooLargeError(`File exceeds the ${MAX_FILE_SIZE_MB} MB size limit`)
	}
}

export function resolveRenameTarget(name: string, requested: string): string {
	const trimmed = requested.trim()
	if (!trimmed) throw new InvalidFileError("File name must not be empty")
	const ext = extname(name).toLowerCase()
	const target = trimmed.toLowerCase().endsWith(ext) ? trimmed : `${trimmed}${ext}`
	validateName(target)
	return target
}

async function list(agentId: string): Promise<StoredFile[]> {
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

async function listAgentDirectories(): Promise<string[]> {
	try {
		const entries = await readdir(env.TALQO_UPLOAD_DIR, { withFileTypes: true })
		return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return []
		throw error
	}
}

async function put(agentId: string, name: string, data: ArrayBuffer): Promise<StoredFile> {
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

export async function get(agentId: string, name: string): Promise<Uint8Array> {
	try {
		return await readFile(join(agentDir(agentId), name))
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new FileNotFoundError(`File ${name} not found`)
		throw error
	}
}

async function requireFile(agentId: string, name: string): Promise<void> {
	try {
		await stat(join(agentDir(agentId), name))
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new FileNotFoundError(`File ${name} not found`)
		throw error
	}
}

// COPYFILE_EXCL must succeed before removing the source: otherwise renaming to an existing name would clobber it.
async function renameFile(agentId: string, oldName: string, newName: string): Promise<StoredFile> {
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

async function remove(agentId: string, name: string): Promise<void> {
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

const WORKER_INTERVAL_MS = 3_000
// Derive the advisory-lock key from the feature name; mask to a signed bigint for Postgres.
const WORKER_LOCK_KEY = BigInt(Bun.hash("knowledge-base-ingestion")) & 0x7fff_ffff_ffff_ffffn

export class FileNotRetryableError extends Error {}

export async function upload(agentId: string, name: string, data: ArrayBuffer): Promise<IndexedFile> {
	const stored = await put(agentId, name, data)
	try {
		await repository.enqueue(agentId, name)
	} catch (error) {
		await remove(agentId, name)
		throw error
	}
	return { ...stored, embeddingStatus: "pending", embeddingError: null }
}

export async function listWithStatus(agentId: string): Promise<IndexedFile[]> {
	const listed = await list(agentId)
	const statuses = await repository.statuses(agentId)
	return listed.map((file) => {
		const status = statuses.get(file.name)
		return Object.assign(file, {
			embeddingStatus: status?.status ?? "pending",
			embeddingError: status?.error ?? null,
		})
	})
}

export async function rename(agentId: string, oldName: string, newName: string): Promise<IndexedFile> {
	const file = await renameFile(agentId, oldName, newName)
	try {
		await repository.rename(agentId, oldName, newName)
	} catch (error) {
		await renameFile(agentId, newName, oldName).catch((compensationError: unknown) =>
			console.error("agent-file.rename.compensation_failed", { agentId, newName, compensationError }),
		)
		throw error
	}
	const status = (await repository.statuses(agentId)).get(newName)
	return { ...file, embeddingStatus: status?.status ?? "pending", embeddingError: status?.error ?? null }
}

export async function deleteFile(agentId: string, name: string): Promise<void> {
	await remove(agentId, name)
	await repository.remove(agentId, name)
}

export async function retryEmbedding(agentId: string, name: string): Promise<void> {
	await requireFile(agentId, name)
	if (!(await repository.retry(agentId, name))) throw new FileNotRetryableError("File is not in a failed state")
}

const RETRIEVAL_TOP_K = 5

export async function searchKnowledge(agentId: string, text: string): Promise<string[]> {
	const operation = await aiProvider.prepareEmbeddingOperation()
	return repository.search(agentId, await operation.embed(text), operation.key, RETRIEVAL_TOP_K)
}

async function recoverUploads(): Promise<void> {
	/* eslint-disable no-await-in-loop -- scan local directories without flooding the database */
	for (const agentId of await listAgentDirectories()) {
		try {
			await Promise.all((await list(agentId)).map((file) => repository.enqueue(agentId, file.name)))
		} catch (error) {
			if (!isForeignKeyViolation(error)) throw error
		}
	}
	/* eslint-enable no-await-in-loop */
}

async function convert(job: repository.Job): Promise<string[]> {
	try {
		return await chunkFile(job.name, await get(job.agentId, job.name), env.TALQO_DOCLING_URL)
	} catch (error) {
		throw new IngestionError("conversion-failed", { cause: error })
	}
}

export async function runIngestion(): Promise<void> {
	const connection = await (await import("@/db/client.ts")).sql.reserve()
	let locked = false
	try {
		const result = await connection<
			{ acquired: boolean }[]
		>`SELECT pg_try_advisory_lock(${WORKER_LOCK_KEY.toString()}::bigint) AS acquired`
		locked = result[0]?.acquired ?? false
		if (!locked) return
		await repository.recover()
		await recoverUploads()
		/* eslint-disable no-await-in-loop -- each batch finishes before the next poll */
		for (;;) {
			await connection`SELECT 1`
			try {
				const model = await aiProvider.prepareEmbeddingOperation()
				await repository.reindexChanged(model.key)
				await processPendingFiles({
					claim: async () => {
						await connection`SELECT 1`
						return repository.claim(model.key)
					},
					convert,
					embed: async (text) => {
						await connection`SELECT 1`
						try {
							return await model.embed(text)
						} catch (error) {
							throw new IngestionError("provider-error", {
								cause: error,
							})
						}
					},
					complete: async (job, chunks) => {
						await connection`SELECT 1`
						let currentKey: string
						try {
							currentKey = (await aiProvider.prepareEmbeddingOperation()).key
						} catch (error) {
							if (error instanceof aiProvider.UnusableConfigurationError) {
								await repository.requeue(job)
								return
							}
							throw error
						}
						if (currentKey !== model.key) {
							await repository.requeue(job)
							return
						}
						await repository.complete(job, model.key, chunks)
					},
					fail: async (job, error) => {
						console.error("agent-file.embedding.failed", { agentId: job.agentId, file: job.name, error })
						await repository.fail(job, error instanceof IngestionError ? error.reason : "unknown")
					},
				})
			} catch (error) {
				if (!(error instanceof aiProvider.UnusableConfigurationError))
					console.error("agent-file.worker.failed", { error })
			}
			await Bun.sleep(WORKER_INTERVAL_MS)
		}
		/* eslint-enable no-await-in-loop */
	} finally {
		try {
			if (locked) await connection`SELECT pg_advisory_unlock(${WORKER_LOCK_KEY.toString()}::bigint)`
		} finally {
			connection.release()
		}
	}
}
