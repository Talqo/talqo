import type { Root } from "react-dom/client"

import { GlobalRegistrator } from "@happy-dom/global-registrator"
import { afterEach, beforeEach, expect, test } from "bun:test"

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register({ url: "http://localhost/" })
await import("@/lib/i18n")
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const { useDirtyFormGuard } = await import("./use-dirty-form-guard")
const { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } =
	await import("@tanstack/react-router")
const { createRoot } = await import("react-dom/client")
const { act } = await import("react")
const { t } = await import("i18next")

const OPEN_DASHBOARD_LABEL = "Open dashboard"
const JUMP_TO_SECTION_LABEL = "Jump to section"

let router: ReturnType<typeof makeRouter>
let host: HTMLDivElement
let root: Root

function makeRouter(isDirty: boolean) {
	const rootRoute = createRootRoute({ component: () => <Outlet /> })
	const page = createRoute({ getParentRoute: () => rootRoute, path: "/", component: () => <Guard isDirty={isDirty} /> })
	const next = createRoute({ getParentRoute: () => rootRoute, path: "/dashboard", component: () => null })
	return createRouter({
		routeTree: rootRoute.addChildren([page, next]),
		history: createMemoryHistory({ initialEntries: ["/"] }),
	})
}

function Guard({ isDirty }: { isDirty: boolean }) {
	const guard = useDirtyFormGuard(isDirty)
	return (
		<>
			{guard}
			<button
				type="button"
				data-testid="to-next"
				aria-label={OPEN_DASHBOARD_LABEL}
				onClick={() => void router.navigate({ to: "/dashboard" })}
			/>
			<button
				type="button"
				data-testid="same-page"
				aria-label={JUMP_TO_SECTION_LABEL}
				onClick={() => void router.navigate({ to: "/", hash: "section" })}
			/>
		</>
	)
}

async function settle() {
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 0))
	})
}

async function renderGuard(isDirty: boolean) {
	router = makeRouter(isDirty)
	await act(async () => {
		await router.load()
		root.render(<RouterProvider router={router} />)
	})
	await settle()
}

function button(label: string): HTMLButtonElement {
	const match = [...document.querySelectorAll<HTMLButtonElement>("[role='alertdialog'] button")].find(
		(element) => element.textContent?.trim() === label,
	)
	if (!match) throw new Error(`Missing dialog button: ${label}`)
	return match
}

async function click(element: HTMLElement | null) {
	if (!element) throw new Error("Missing element to click")
	await act(async () => element.click())
	await settle()
}

beforeEach(() => {
	host = document.createElement("div")
	document.body.append(host)
	root = createRoot(host)
})

afterEach(async () => {
	await act(async () => root.unmount())
	host.remove()
})

test("navigates without a prompt when the form is unchanged", async () => {
	await renderGuard(false)

	await click(host.querySelector<HTMLElement>('[data-testid="to-next"]'))

	expect(router.state.location.pathname).toBe("/dashboard")
	expect(document.querySelector("[role='alertdialog']")).toBeNull()
})

test("does not prompt for same-page navigation", async () => {
	await renderGuard(true)

	await click(host.querySelector<HTMLElement>('[data-testid="same-page"]'))

	expect(router.state.location.pathname).toBe("/")
	expect(document.querySelector("[role='alertdialog']")).toBeNull()
})

test("keeps editing or discards changes when navigation is blocked", async () => {
	await renderGuard(true)
	const navigate = () => click(host.querySelector<HTMLElement>('[data-testid="to-next"]'))

	await navigate()
	expect(router.state.location.pathname).toBe("/")
	expect(document.querySelector("[role='alertdialog']")?.textContent).toContain(t("common.discardTitle"))

	await click(button(t("common.keepEditing")))
	expect(document.querySelector("[role='alertdialog']")).toBeNull()
	expect(router.state.location.pathname).toBe("/")

	await navigate()
	await click(button(t("common.discardChanges")))
	expect(router.state.location.pathname).toBe("/dashboard")
	expect(document.querySelector("[role='alertdialog']")).toBeNull()
})
