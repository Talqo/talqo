import type { Root } from "react-dom/client"

import { GlobalRegistrator } from "@happy-dom/global-registrator"
import { afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test"

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

let host: HTMLDivElement
let root: Root
let queryClient: InstanceType<typeof QueryClient>
let deleteRequests: number
let deleteResponse: Promise<Response>

async function settle() {
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 0))
	})
}

function button(name: string, scope: ParentNode = document): HTMLButtonElement {
	const found = [...scope.querySelectorAll("button")].find((element) => element.textContent?.trim() === name)
	if (!found) throw new Error(`Button "${name}" not rendered`)
	return found
}

async function click(element: HTMLElement) {
	await act(async () => element.click())
	await settle()
}

beforeEach(() => {
	deleteRequests = 0
	deleteResponse = Promise.resolve(new Response(null, { status: 500 }))
	const respond = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
		const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
		if (url === "/api/me/permissions") {
			return Promise.resolve(Response.json({ permissions: [] }))
		}
		if (url === "/api/me" && init?.method === "DELETE") {
			deleteRequests += 1
			return deleteResponse
		}
		throw new Error(`Unexpected request ${url}`)
	}
	spyOn(globalThis, "fetch").mockImplementation(Object.assign(respond, { preconnect: fetch.preconnect }))
	queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
	host = document.createElement("div")
	document.body.append(host)
	root = createRoot(host)
})

afterEach(async () => {
	await act(async () => root.unmount())
	host.remove()
	queryClient.clear()
	mock.restore()
})

test("keeps confirmation open after failure, allows retry, and blocks duplicate submissions", async () => {
	const router = createRouter({ routeTree: createRootRoute(), history: createMemoryHistory() })
	queryClient.setQueryData(["private-account-data"], "retained on failure")
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
	expect(dialog.querySelector("[role='alert']")?.textContent).toBe(t("account.deleteFailed"))
	expect(deleteRequests).toBe(1)
	expect(queryClient.getQueryData(["private-account-data"])).toBe("retained on failure")

	const pending = Promise.withResolvers<Response>()
	deleteResponse = pending.promise
	await click(button(t("account.deleteAccount"), dialog))
	expect(button(t("account.deleting"), dialog).disabled).toBe(true)
	expect(button(t("account.cancel"), dialog).disabled).toBe(true)
	expect([...dialog.querySelectorAll("button")].every((element) => element.disabled)).toBe(true)
	await click(button(t("account.deleting"), dialog))
	expect(deleteRequests).toBe(2)
	await act(async () => pending.resolve(new Response(null, { status: 500 })))
	await settle()
	await click(button(t("account.cancel"), dialog))
	expect(document.querySelector("[role='dialog']")).toBeNull()
})
