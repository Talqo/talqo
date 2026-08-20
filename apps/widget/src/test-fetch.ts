/**
 * Runs `act` with a fetch that records the call instead of hitting the network, and
 * reports whether it fired. The stub is deliberately partial -- callers only ever
 * assert that no request happened.
 */
export function fetchCalledDuring(act: () => void): boolean {
	const original = globalThis.fetch
	let called = false
	globalThis.fetch = (() => {
		called = true
		return Promise.reject(new Error("unexpected fetch"))
	}) as unknown as typeof fetch

	try {
		act()
		return called
	} finally {
		globalThis.fetch = original
	}
}
