import * as repository from "./conversation.repository.ts"

const CANCELLATION_POLL_MS = 500
const HEARTBEAT_MS = 5_000
const POLL_BATCH_SIZE = 100

// Single-flight coordinator: batch-checks cancellation and renews PostgreSQL-time leases for locally owned attempts.
export function createGenerationPoller() {
	const controllers = new Map<string, { controller: AbortController; leaseToken: string }>()
	let pollTimer: ReturnType<typeof setTimeout> | undefined
	let polling = false
	let pollErrorReported = false
	let lastHeartbeat = performance.now()

	async function poll(): Promise<void> {
		pollTimer = undefined
		if (controllers.size === 0) return
		polling = true
		const renew = performance.now() - lastHeartbeat >= HEARTBEAT_MS
		const owned = [...controllers].map(([id, { leaseToken }]) => ({ id, leaseToken }))
		try {
			for (let offset = 0; offset < owned.length; offset += POLL_BATCH_SIZE) {
				// oxlint-disable-next-line no-await-in-loop -- sequential batches bound database work per query.
				const active = await repository.pollRunningAttempts(owned.slice(offset, offset + POLL_BATCH_SIZE), renew)
				const status = new Map(active.map((entry) => [entry.id, entry.cancelled]))
				for (const { id, leaseToken } of owned.slice(offset, offset + POLL_BATCH_SIZE)) {
					const local = controllers.get(id)
					if (local?.leaseToken === leaseToken && status.get(id) !== false) local.controller.abort()
				}
			}
			if (renew) lastHeartbeat = performance.now()
			pollErrorReported = false
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
			controllers.get(id)?.controller.abort()
		},
	}
}
