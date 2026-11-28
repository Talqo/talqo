import * as repository from "./conversation.repository.ts"

const CANCELLATION_POLL_MS = 500
const HEARTBEAT_MS = 5000
const POLL_BATCH_SIZE = 100
export const CANCELLATION_REASON = "chat-cancelled"

// Single-flight coordinator: batch-checks cancellation and renews PostgreSQL-time leases for locally owned attempts.
export function createGenerationPoller() {
	const controllers = new Map<string, { controller: AbortController; leaseToken: string }>()
	let pollTimer: ReturnType<typeof setTimeout> | undefined
	let polling = false
	let pollErrorReported = false
	let lastHeartbeat = performance.now()

	function abortUnavailable(
		batch: Array<{ id: string; leaseToken: string }>,
		active: Array<{ id: string; cancelled: boolean }>,
	) {
		const cancelled = new Map(active.map((entry) => [entry.id, entry.cancelled]))
		for (const { id, leaseToken } of batch) {
			const local = controllers.get(id)
			if (local?.leaseToken === leaseToken && cancelled.get(id) !== false)
				local.controller.abort(cancelled.get(id) ? CANCELLATION_REASON : undefined)
		}
	}

	async function pollBatches(owned: Array<{ id: string; leaseToken: string }>, renew: boolean): Promise<void> {
		// One batch at a time keeps each poll query bounded.
		for (let offset = 0; offset < owned.length; offset += POLL_BATCH_SIZE) {
			const batch = owned.slice(offset, offset + POLL_BATCH_SIZE)
			abortUnavailable(batch, await repository.pollRunningAttempts(batch, renew))
		}
		if (renew) lastHeartbeat = performance.now()
		pollErrorReported = false
	}

	async function poll(): Promise<void> {
		pollTimer = undefined
		if (controllers.size === 0) return
		polling = true
		const owned = [...controllers].map(([id, { leaseToken }]) => ({ id, leaseToken }))
		try {
			await pollBatches(owned, performance.now() - lastHeartbeat >= HEARTBEAT_MS)
		} catch (error) {
			if (!pollErrorReported) console.error("conversation.poll.failed", { error })
			pollErrorReported = true
		} finally {
			polling = false
			if (controllers.size > 0) pollTimer = setTimeout(() => void poll(), CANCELLATION_POLL_MS)
		}
	}

	return {
		register(id: string, leaseToken: string, controller: AbortController): void {
			controllers.set(id, { leaseToken, controller })
			if (!pollTimer && !polling) {
				lastHeartbeat = performance.now()
				pollTimer = setTimeout(() => void poll(), CANCELLATION_POLL_MS)
			}
		},
		unregister(id: string): void {
			controllers.delete(id)
			if (controllers.size === 0) {
				clearTimeout(pollTimer)
				pollTimer = undefined
			}
		},
		abort(id: string): void {
			controllers.get(id)?.controller.abort(CANCELLATION_REASON)
		},
	}
}
