export type AsyncStorage = {
	getItem(key: string): Promise<string | null>
	setItem(key: string, value: string): Promise<void>
	removeItem(key: string): Promise<void>
}

export const CHAT_STORAGE_VERSION = 1 as const

type PendingMessage = {
	requestId: string
	text: string
}

export type ChatStorageRecord = {
	version: typeof CHAT_STORAGE_VERSION
	credential: string
	pending?: PendingMessage
}

export type ResilientStorage = AsyncStorage & {
	isFallback(): boolean
}

export function createMemoryStorage(): AsyncStorage {
	const values = new Map<string, string>()
	return {
		getItem: async (key) => values.get(key) ?? null,
		setItem: async (key, value) => {
			values.set(key, value)
		},
		removeItem: async (key) => {
			values.delete(key)
		},
	}
}

export function createResilientStorage(
	primary: AsyncStorage,
	fallback: AsyncStorage = createMemoryStorage(),
	onFallback?: (error: unknown) => void,
): ResilientStorage {
	let active = primary
	let usingFallback = false

	async function perform<T>(operation: (storage: AsyncStorage) => Promise<T>): Promise<T> {
		try {
			return await operation(active)
		} catch (error) {
			if (!usingFallback) {
				usingFallback = true
				active = fallback
				onFallback?.(error)
				return operation(active)
			}
			throw error
		}
	}

	return {
		getItem: (key) => perform((storage) => storage.getItem(key)),
		setItem: (key, value) => perform((storage) => storage.setItem(key, value)),
		removeItem: (key) => perform((storage) => storage.removeItem(key)),
		isFallback: () => usingFallback,
	}
}

export function createChatStorageKey(apiUrl: string, embedToken: string): string {
	const normalizedUrl = apiUrl.replace(/\/$/, "")
	return `talqo:chat:v${CHAT_STORAGE_VERSION}:${encodeURIComponent(normalizedUrl)}:${encodeURIComponent(embedToken)}`
}

function isPendingMessage(value: unknown): value is PendingMessage {
	return (
		typeof value === "object" &&
		value !== null &&
		"requestId" in value &&
		typeof value.requestId === "string" &&
		"text" in value &&
		typeof value.text === "string"
	)
}

function isChatStorageRecord(value: unknown): value is ChatStorageRecord {
	if (typeof value !== "object" || value === null || !("version" in value) || value.version !== CHAT_STORAGE_VERSION) {
		return false
	}
	if (!("credential" in value) || typeof value.credential !== "string") return false
	return !("pending" in value) || value.pending === undefined || isPendingMessage(value.pending)
}

export function readChatStorageRecord(serialized: string | null): ChatStorageRecord | null {
	if (serialized === null) return null
	try {
		const value: unknown = JSON.parse(serialized)
		return isChatStorageRecord(value) ? value : null
	} catch {
		return null
	}
}
