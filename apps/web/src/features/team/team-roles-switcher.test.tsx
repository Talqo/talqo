import { json } from "@/testing/api-responses"
import { createTestHarness, type QueryClient, type Root } from "@/testing/component-harness"
import { renderRouter } from "@/testing/router"
import { afterEach, beforeEach, describe, expect, test } from "bun:test"

const { TeamRolesSwitcher } = await import("./team-roles-switcher")
const { createMemoryHistory, createRootRoute, createRouter } = await import("@tanstack/react-router")

let permissions: string[]
let harness: ReturnType<typeof createTestHarness>
let host: HTMLDivElement
let root: Root
let queryClient: InstanceType<typeof QueryClient>

async function renderSwitcher() {
	const rootRoute = createRootRoute({ component: () => <TeamRolesSwitcher /> })
	const router = createRouter({ routeTree: rootRoute, history: createMemoryHistory() })
	await renderRouter(root, queryClient, router)
}

beforeEach(() => {
	permissions = []
	harness = createTestHarness({
		fetch: (async (input: RequestInfo | URL) => {
			const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
			if (url === "/api/me/permissions") return json({ permissions })
			throw new Error(`unexpected request ${url}`)
		}) as typeof fetch,
	})
	;({ host, root, queryClient } = harness)
})

afterEach(async () => {
	await harness.dispose()
})

describe("TeamRolesSwitcher", () => {
	test("stays hidden without role management access", async () => {
		permissions = ["users:read"]
		await renderSwitcher()

		expect(host.querySelector("nav")).toBeNull()
	})
})
