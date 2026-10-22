import { GlobalRegistrator } from "@happy-dom/global-registrator"
import { expect, spyOn, test } from "bun:test"

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register({ url: "http://localhost/" })
await import("@/lib/i18n")
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const { DeleteAccountCard } = await import("./delete-account-card")
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query")
const { createRouter, createRootRoute, createMemoryHistory, RouterContextProvider } =
	await import("@tanstack/react-router")
const { createRoot } = await import("react-dom/client")
const { act } = await import("react")
const { t } = await import("i18next")

async function settle() {
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 0))
	})
}

function button(name: string, scope: ParentNode): HTMLButtonElement {
	const found = [...scope.querySelectorAll("button")].find((element) => element.textContent?.trim() === name)
	if (!found) throw new Error(`Button "${name}" not rendered`)
	return found
}

async function click(element: HTMLElement) {
	await act(async () => element.click())
	await settle()
}

test("keeps failed deletion open for retry and prevents actions while deletion is pending", async () => {
	let deletion = Promise.withResolvers<Response>()
	let requests = 0
	const respond = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
		const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
		if (url === "/api/me/permissions") return Response.json({ permissions: [] })
		if (url === "/api/me" && init?.method === "DELETE") {
			requests += 1
			return deletion.promise
		}
		throw new Error(`Unexpected request ${init?.method ?? "GET"} ${url}`)
	}
	const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
		Object.assign(respond, { preconnect: fetch.preconnect }),
	)
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
	const router = createRouter({ routeTree: createRootRoute(), history: createMemoryHistory() })
	const host = document.createElement("div")
	document.body.append(host)
	const root = createRoot(host)
	try {
		await act(async () =>
			root.render(
				<RouterContextProvider router={router}>
					<QueryClientProvider client={queryClient}>
						<DeleteAccountCard />
					</QueryClientProvider>
				</RouterContextProvider>,
			),
		)
		await settle()
		await click(button(t("account.deleteAccount"), host))
		const dialog = document.querySelector<HTMLElement>("[role='dialog']")
		if (!dialog) throw new Error("Confirmation dialog not rendered")
		await click(button(t("account.deleteAccount"), dialog))
		expect(button(t("account.cancel"), dialog).disabled).toBe(true)
		expect(button(t("account.deleting"), dialog).disabled).toBe(true)
		await click(button(t("account.deleting"), dialog))
		expect(requests).toBe(1)
		await act(async () => deletion.resolve(new Response(null, { status: 500 })))
		await settle()
		expect(dialog.isConnected).toBe(true)
		expect(dialog.querySelector("[role='alert']")?.textContent).toBe(t("account.deleteFailed"))
		expect(button(t("account.cancel"), dialog).disabled).toBe(false)
		deletion = Promise.withResolvers<Response>()
		await click(button(t("account.deleteAccount"), dialog))
		expect(requests).toBe(2)
		await act(async () => deletion.resolve(new Response(null, { status: 500 })))
		await settle()
		await click(button(t("account.cancel"), dialog))
		await click(button(t("account.deleteAccount"), host))
		expect(document.querySelector("[role='alert']")).toBeNull()
	} finally {
		await act(async () => root.unmount())
		host.remove()
		queryClient.clear()
		fetchSpy.mockRestore()
	}
})
