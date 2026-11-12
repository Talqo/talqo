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

type TestHarnessOptions = {
	fetch?: typeof fetch
	queryClient?: InstanceType<typeof QueryClient>
}

type TestHarness = {
	host: HTMLDivElement
	root: Root
	queryClient: InstanceType<typeof QueryClient>
	dispose: () => Promise<void>
}

export function createTestHarness(options: TestHarnessOptions = {}): TestHarness {
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
