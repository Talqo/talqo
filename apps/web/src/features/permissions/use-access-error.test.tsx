import type { Root } from "react-dom/client"

import { getListAgentsQueryKey } from "@/api/generated/agent/agent"
import { getGetMyPermissionsQueryKey } from "@/api/generated/roles/roles"
import { GlobalRegistrator } from "@happy-dom/global-registrator"
import { afterEach, describe, expect, test } from "bun:test"

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register({ url: "http://localhost/" })
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const { useAccessError } = await import("./use-access-error")
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query")
const { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } =
	await import("@tanstack/react-router")
const { createRoot } = await import("react-dom/client")
const { act, useEffect, useState } = await import("react")

const ACCESS_QUERY_KEYS = [getGetMyPermissionsQueryKey(), getListAgentsQueryKey()]
const UNRELATED_QUERY_KEY = ["unrelated-access-test"]
const CACHED_QUERY_KEYS = [...ACCESS_QUERY_KEYS, UNRELATED_QUERY_KEY]

let host: HTMLDivElement | undefined
let root: Root | undefined
let queryClient: InstanceType<typeof QueryClient> | undefined

function failure(status: number): Error & { status: number } {
	return Object.assign(new Error("request failed"), { status })
}

type ErrorUpdate = (errors: unknown[]) => void

function AccessErrorProbe({ errors }: { errors: unknown[] }) {
	return <output>{String(useAccessError(...errors))}</output>
}

function AccessErrorHarness({
	initialErrors,
	registerUpdate,
}: {
	initialErrors: unknown[]
	registerUpdate: (update: ErrorUpdate) => void
}) {
	const [errors, setErrors] = useState(initialErrors)
	useEffect(() => {
		registerUpdate(setErrors)
	}, [registerUpdate])
	return <AccessErrorProbe errors={errors} />
}

async function settle() {
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 0))
	})
}

async function renderAccessError(...errors: unknown[]) {
	const client = new QueryClient()
	let updateProbe: ErrorUpdate | undefined
	function registerUpdate(update: ErrorUpdate) {
		updateProbe = update
	}
	queryClient = client
	for (const queryKey of CACHED_QUERY_KEYS) client.setQueryData(queryKey, {})
	host = document.createElement("div")
	document.body.append(host)
	root = createRoot(host)
	const rootRoute = createRootRoute()
	const page = createRoute({
		getParentRoute: () => rootRoute,
		path: "/",
		component: () => <AccessErrorHarness initialErrors={errors} registerUpdate={registerUpdate} />,
	})
	const login = createRoute({
		getParentRoute: () => rootRoute,
		path: "/login",
		component: () => <p data-testid="login-route" />,
	})
	const router = createRouter({
		routeTree: rootRoute.addChildren([page, login]),
		history: createMemoryHistory(),
	})
	await act(async () => {
		await router.load()
		root?.render(
			<QueryClientProvider client={client}>
				<RouterProvider router={router} />
			</QueryClientProvider>,
		)
	})
	await settle()
	await settle()
	async function updateErrors(nextErrors: unknown[]) {
		if (!updateProbe) throw new Error("access error harness did not initialize")
		await act(async () => updateProbe?.(nextErrors))
		await settle()
		await settle()
	}
	return { queryClient: client, router, updateErrors }
}

function invalidationStates(client: NonNullable<typeof queryClient>): boolean[] {
	return CACHED_QUERY_KEYS.map((queryKey) => client.getQueryState(queryKey)?.isInvalidated ?? false)
}

afterEach(async () => {
	await act(async () => root?.unmount())
	host?.remove()
	queryClient?.clear()
})

describe("useAccessError", () => {
	test("redirects a 401 to login without invalidating access queries", async () => {
		const { queryClient: client, router } = await renderAccessError(failure(401))

		expect(router.state.location.pathname).toBe("/login")
		expect(invalidationStates(client)).toEqual([false, false, false])
	})

	test("reports a 403 and invalidates permission and agent queries without redirecting", async () => {
		const { queryClient: client, router } = await renderAccessError(failure(403))

		expect(router.state.location.pathname).toBe("/")
		expect(host?.querySelector("output")?.textContent).toBe("true")
		expect(invalidationStates(client)).toEqual([true, true, false])
	})

	test("leaves navigation and access queries unchanged for a 500", async () => {
		const { queryClient: client, router } = await renderAccessError(failure(500))

		expect(router.state.location.pathname).toBe("/")
		expect(host?.querySelector("output")?.textContent).toBe("false")
		expect(invalidationStates(client)).toEqual([false, false, false])
	})

	test("handles access errors that arrive after the initial render", async () => {
		const { queryClient: client, router, updateErrors } = await renderAccessError()

		await updateErrors([failure(403)])
		expect(host?.querySelector("output")?.textContent).toBe("true")
		expect(invalidationStates(client)).toEqual([true, true, false])

		await updateErrors([failure(401)])
		expect(router.state.location.pathname).toBe("/login")
	})

	test("ignores null and non-object errors", async () => {
		const { queryClient: client, router } = await renderAccessError(null, "request failed", undefined)

		expect(router.state.location.pathname).toBe("/")
		expect(host?.querySelector("output")?.textContent).toBe("false")
		expect(invalidationStates(client)).toEqual([false, false, false])
	})

	test("gives a 401 precedence over a simultaneous 403", async () => {
		const { queryClient: client, router } = await renderAccessError(failure(403), failure(401))

		expect(router.state.location.pathname).toBe("/login")
		expect(invalidationStates(client)).toEqual([false, false, false])
	})
})
