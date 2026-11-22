import { env } from "@/config/env.ts"
import { tmpdir } from "node:os"
import { join } from "node:path"

// Knowledge files sit directly under the root as `<agentId>/`; other modules take a name no agent UUID can match.
const MODULE_DIRS = { embedIcons: "embed-icons" } as const

export function uploadRoot(): string {
	return env.TALQO_UPLOAD_DIR ?? join(tmpdir(), "talqo")
}

export function moduleUploadDir(module: keyof typeof MODULE_DIRS): string {
	return join(uploadRoot(), MODULE_DIRS[module])
}

export function isModuleUploadDir(name: string): boolean {
	return (Object.values(MODULE_DIRS) as string[]).includes(name)
}
