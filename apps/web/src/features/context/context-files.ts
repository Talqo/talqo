export type ContextFile = {
	name: string
	sizeBytes: number
	createdAt: string
}

export type ContextFilesResponse = {
	files: ContextFile[]
	maxSizeBytes: number
	maxNameLength: number
}

async function throwOnError(response: Response): Promise<void> {
	if (response.ok) return
	const body: unknown = await response.json().catch(() => undefined)
	const fallback = response.statusText || "Request failed"
	const message =
		typeof body === "object" && body !== null && "error" in body && typeof body.error === "string"
			? body.error
			: fallback
	throw new Error(message)
}

export async function createContext(): Promise<string> {
	const response = await fetch("/api/context", { method: "POST", credentials: "include" })
	await throwOnError(response)
	const body = (await response.json()) as { contextId: string }
	return body.contextId
}

export async function listContextFiles(contextId: string): Promise<ContextFilesResponse> {
	const response = await fetch(`/api/context/${contextId}/files`, { credentials: "include" })
	await throwOnError(response)
	return (await response.json()) as ContextFilesResponse
}

export async function uploadContextFile(contextId: string, file: File): Promise<ContextFile> {
	const form = new FormData()
	form.append("file", file)
	const response = await fetch(`/api/context/${contextId}/files`, {
		method: "POST",
		credentials: "include",
		body: form,
	})
	await throwOnError(response)
	return ((await response.json()) as { file: ContextFile }).file
}

export async function deleteContextFile(contextId: string, name: string): Promise<void> {
	const response = await fetch(`/api/context/${contextId}/files/${encodeURIComponent(name)}`, {
		method: "DELETE",
		credentials: "include",
	})
	await throwOnError(response)
}
