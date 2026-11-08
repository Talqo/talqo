import type { Root } from "react-dom/client"

import { GlobalRegistrator } from "@happy-dom/global-registrator"
import { mock, spyOn } from "bun:test"

// Component test files share one process, so only the first one registers the DOM.
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register({ url: "http://localhost/" })
await import("@/lib/i18n")
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query")
const { createRoot } = await import("react-dom/client")
const { act } = await import("react")

export { act, QueryClient, QueryClientProvider }
export type { Root }

export async function settle(): Promise<void> {
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 0))
	})
}

export function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

export function parseJsonBody(body: BodyInit | null | undefined): unknown {
	if (typeof body !== "string") throw new Error("Expected a JSON request body")
	return JSON.parse(body)
}

function requestUrl(input: RequestInfo | URL): string {
	if (typeof input === "string") return input
	if (input instanceof URL) return input.href
	return input.url
}

export function requestDetails(input: RequestInfo | URL, init?: RequestInit) {
	const method = init?.method ?? "GET"
	return { url: requestUrl(input), method, body: init?.body ? parseJsonBody(init.body) : undefined }
}

type TestHarnessOptions = {
	fetch?: typeof fetch
	queryClient?: InstanceType<typeof QueryClient>
}

export function createTestHarness(options: TestHarnessOptions = {}) {
	if (options.fetch) spyOn(globalThis, "fetch").mockImplementation(options.fetch)
	const queryClient = options.queryClient ?? new QueryClient({ defaultOptions: { queries: { retry: false } } })
	const host = document.createElement("div")
	document.body.append(host)
	const root = createRoot(host)

	return {
		host,
		root,
		queryClient,
		async dispose() {
			await act(async () => root.unmount())
			host.remove()
			queryClient.clear()
			mock.restore()
		},
	}
}
