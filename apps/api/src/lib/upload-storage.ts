import { env } from "@/config/env.ts"
import { mkdir, readdir, rename, rmdir, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

const UPLOAD_AREAS = ["knowledge", "embeds"] as const
type UploadArea = (typeof UPLOAD_AREAS)[number]

function uploadRoot(): string {
	return env.TALQO_UPLOAD_DIR ?? join(tmpdir(), "talqo")
}

/** One directory per owning module, so each module's startup sweep sees only its own files. */
export function uploadAreaDir(area: UploadArea): string {
	return join(uploadRoot(), area)
}

function isUploadArea(name: string): name is UploadArea {
	return (UPLOAD_AREAS as readonly string[]).includes(name)
}

function errorCode(error: unknown): string | undefined {
	return (error as NodeJS.ErrnoException).code
}

async function exists(path: string): Promise<boolean> {
	try {
		await stat(path)
		return true
	} catch (error) {
		if (errorCode(error) === "ENOENT") return false
		throw error
	}
}

// A replica already on the new layout may have created the target; merge without overwriting its files.
async function mergeDirectory(source: string, target: string): Promise<void> {
	for (const name of await readdir(source)) {
		if (await exists(join(target, name))) {
			console.error("uploads.layout.conflict", { source, name })
			continue
		}
		await rename(join(source, name), join(target, name))
	}
	try {
		await rmdir(source)
	} catch (error) {
		if (errorCode(error) !== "ENOTEMPTY" && errorCode(error) !== "ENOENT") throw error
	}
}

async function moveDirectory(source: string, target: string): Promise<void> {
	try {
		await rename(source, target)
	} catch (error) {
		const code = errorCode(error)
		// ENOENT: another replica moved it first.
		if (code === "ENOENT") return
		if (code !== "EEXIST" && code !== "ENOTEMPTY") throw error
		await mergeDirectory(source, target)
	}
}

/**
 * Knowledge files used to live directly under the root as `<agentId>/`. Runs before the server
 * accepts requests so no read sees a half-moved layout; safe to rerun after a crash.
 * Never creates the root: a missing root means unmounted storage, which recovery must detect.
 */
export async function migrateLegacyUploadLayout(): Promise<void> {
	let entries
	try {
		entries = await readdir(uploadRoot(), { withFileTypes: true })
	} catch (error) {
		if (errorCode(error) === "ENOENT") return
		throw error
	}
	const legacy = entries.filter((entry) => entry.isDirectory() && !isUploadArea(entry.name))
	if (legacy.length === 0) return
	const knowledge = uploadAreaDir("knowledge")
	await mkdir(knowledge, { recursive: true })
	for (const entry of legacy) {
		await moveDirectory(join(uploadRoot(), entry.name), join(knowledge, entry.name))
	}
	console.info("uploads.layout.migrated", { moved: legacy.length })
}
