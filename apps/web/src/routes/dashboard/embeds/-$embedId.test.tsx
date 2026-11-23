import type { Embed } from "@/api/generated/models/embed.zod"

import { json } from "@/testing/api-responses"
import { act, createTestHarness, QueryClient, type Root, settle } from "@/testing/component-harness"
import { renderRouter } from "@/testing/router"
import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test"

const { Route } = await import("./$embedId")
const { getGetEmbedQueryKey, getListEmbedsQueryKey } = await import("@/api/generated/embed/embed.ts")
const { createMemoryHistory, createRootRoute, createRoute, createRouter } = await import("@tanstack/react-router")
const { t } = await import("i18next")
const { supportedLanguages } = await import("@talqo/shared/languages")

const EmbedDetailPage = Route.options.component ?? (() => null)

const EMBED_ID = "embed-1"
const AGENT_ID = "original-agent"
const DETAIL_URL = `/api/embeds/${EMBED_ID}`
const INITIAL_EMBED: Embed = {
	id: EMBED_ID,
	agentId: AGENT_ID,
	name: "Storefront",
	embedToken: "initial-token",
	accessVersion: 1,
	isDisabled: false,
	appearance: {
		light: {
			primary: "#1a7f4b",
			textOnPrimary: "#ffffff",
			background: "#ffffff",
			surface: "#f5f5f5",
			text: "#171717",
		},
		dark: {
			primary: "#34d399",
			textOnPrimary: "#052e16",
			background: "#0a0a0a",
			surface: "#1a1a1a",
			text: "#fafafa",
		},
		position: "bottom-right",
		theme: "system",
		themeToggle: false,
		language: "en",
	},
}
const DEFAULT_AGENT_PERMISSIONS = ["agents:read", "agents:manage"]
const CONTRAST_CASES = [
	{ field: "text-on-primary", value: "#1a7f4b" },
	{ field: "background", value: "#171717" },
	{ field: "surface", value: "#171717" },
	{ field: "text", value: "#ffffff" },
] as const
const SAVED_EMBED: Embed = {
	...INITIAL_EMBED,
	name: "Saved by server",
	appearance: {
		...INITIAL_EMBED.appearance,
		light: { ...INITIAL_EMBED.appearance.light, primary: "#abcdef" },
	},
}

let currentEmbed: Embed
let agentPermissions: Array<string>
let includeEmbedAgent: boolean
let detailFailures: Array<Response>
let agentsFailures: Array<Response>
let updateFailures: Array<Response>
let deleteFailures: Array<Response>
let updates: Array<unknown>
let requests: Array<{ url: string; method: string }>
let detailGate: Promise<void> | undefined
let agentsGate: Promise<void> | undefined
let updateGate: Promise<void> | undefined
let harness: ReturnType<typeof createTestHarness>
let host: HTMLDivElement
let root: Root
let queryClient: InstanceType<typeof QueryClient>

async function respond(request: RequestInfo | URL, init?: RequestInit): Promise<Response> {
	const url = typeof request === "string" ? request : request instanceof URL ? request.href : request.url
	const method = init?.method ?? "GET"
	requests.push({ url, method })

	if (url === "/api/agents" && method === "GET") {
		if (agentsGate) await agentsGate
		const failure = agentsFailures.shift()
		if (failure) return failure
		return json({
			agents: [
				{
					id: "read-only-agent",
					name: "Read-only agent",
					createdAt: "2026-01-01T00:00:00.000Z",
					updatedAt: "2026-01-01T00:00:00.000Z",
					permissions: ["agents:read"],
				},
				...(includeEmbedAgent
					? [
							{
								id: AGENT_ID,
								name: "Support agent",
								createdAt: "2026-01-01T00:00:00.000Z",
								updatedAt: "2026-01-01T00:00:00.000Z",
								permissions: agentPermissions,
							},
						]
					: []),
			],
		})
	}
	if (url === DETAIL_URL && method === "GET") {
		if (detailGate) await detailGate
		const failure = detailFailures.shift()
		if (failure) return failure
		return json({ embed: currentEmbed })
	}
	if (url === DETAIL_URL && method === "DELETE") {
		return deleteFailures.shift() ?? new Response(null, { status: 204 })
	}
	if (url === DETAIL_URL && method === "PUT") {
		if (updateGate) await updateGate
		const body = init?.body
		if (typeof body !== "string") throw new Error("Embed update must have a JSON body")
		updates.push(JSON.parse(body))
		const failure = updateFailures.shift()
		if (failure) return failure
		currentEmbed = SAVED_EMBED
		return json({ embed: SAVED_EMBED })
	}
	throw new Error(`Unexpected request ${method} ${url}`)
}

async function renderPage() {
	const rootRoute = createRootRoute()
	const detail = createRoute({
		getParentRoute: () => rootRoute,
		path: "/dashboard/embeds/$embedId",
		validateSearch: Route.options.validateSearch,
		component: EmbedDetailPage,
	})
	const agent = createRoute({
		getParentRoute: () => rootRoute,
		path: "/dashboard/agent/$agentId",
		component: () => <div data-testid="agent-destination" />,
	})
	const router = createRouter({
		routeTree: rootRoute.addChildren([detail, agent]),
		history: createMemoryHistory({ initialEntries: [`/dashboard/embeds/${EMBED_ID}`] }),
	})
	await renderRouter(root, queryClient, router)
	return router
}

function input(selector: string): HTMLInputElement {
	const found = host.querySelector<HTMLInputElement>(selector)
	if (!found) throw new Error(`Input ${selector} not rendered`)
	return found
}

function button(label: string, scope: ParentNode = host): HTMLButtonElement {
	const found = [...scope.querySelectorAll("button")].find(
		(element) => element.textContent?.trim() === label || element.getAttribute("aria-label") === label,
	)
	if (!found) throw new Error(`Button "${label}" not rendered`)
	return found
}

function formStatus(): string | undefined {
	return input("#widget-name").form?.querySelector("output")?.textContent ?? undefined
}

async function choose(triggerSelector: string, label: string) {
	const trigger = host.querySelector<HTMLElement>(triggerSelector)
	if (!trigger) throw new Error(`Select ${triggerSelector} not rendered`)
	await click(trigger)
	const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
		(candidate) => candidate.textContent?.trim() === label,
	)
	if (!option) throw new Error(`Option "${label}" not rendered`)
	await click(option)
}

function deleteDialog(): HTMLElement {
	const found = document.querySelector<HTMLElement>("[role='alertdialog']")
	if (!found) throw new Error("Delete dialog not open")
	return found
}

async function click(element: HTMLElement) {
	await act(async () => element.click())
	await settle()
	await settle()
}

async function submit(formButton: HTMLButtonElement) {
	await act(async () => formButton.form?.requestSubmit(formButton))
	await settle()
	await settle()
}

async function typeInto(element: HTMLInputElement, value: string) {
	await act(async () => {
		Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(element, value)
		element.dispatchEvent(new Event("input", { bubbles: true }))
	})
	await settle()
}

function copyIcon(): "check" | "copy" {
	const icon = button(t("embedSetup.copyEmbed")).querySelector("svg")
	return icon?.getAttribute("class")?.includes("lucide-check") ? "check" : "copy"
}

async function advance(milliseconds: number) {
	await act(async () => jest.advanceTimersByTime(milliseconds))
}

function pending() {
	const { promise, resolve } = Promise.withResolvers<void>()
	return { gate: promise, release: resolve }
}

function stubClipboard(writeText: (text: string) => Promise<void>): () => void {
	const original = Object.getOwnPropertyDescriptor(navigator, "clipboard")
	Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } })
	return () => {
		if (original) Object.defineProperty(navigator, "clipboard", original)
		else Reflect.deleteProperty(navigator, "clipboard")
	}
}

beforeEach(() => {
	currentEmbed = INITIAL_EMBED
	agentPermissions = [...DEFAULT_AGENT_PERMISSIONS]
	includeEmbedAgent = true
	detailFailures = []
	agentsFailures = []
	updateFailures = []
	deleteFailures = []
	updates = []
	requests = []
	detailGate = undefined
	agentsGate = undefined
	updateGate = undefined
	// Production retries failed queries, so the route's own 4xx policy has to override it here.
	harness = createTestHarness({
		fetch: respond as typeof fetch,
		queryClient: new QueryClient({ defaultOptions: { queries: { retry: 3, retryDelay: 0 } } }),
	})
	;({ host, root, queryClient } = harness)
})

afterEach(async () => {
	jest.useRealTimers()
	await harness.dispose()
	window.localStorage.removeItem("talqo-language")
	document.documentElement.lang = "en"
})

describe("embed route search", () => {
	test("accepts only the light and dark color tabs", () => {
		const validateSearch = Route.options.validateSearch
		if (typeof validateSearch !== "function") throw new Error("Embed route has no search validator")

		expect(validateSearch({ colorTab: "light" })).toEqual({ colorTab: "light" })
		expect(validateSearch({ colorTab: "dark" })).toEqual({ colorTab: "dark" })
		expect(validateSearch({ colorTab: "sepia" })).toEqual({ colorTab: undefined })
	})
})

describe("embed appearance saving", () => {
	test("keeps a failed draft dirty and saves with the original agent before resetting from the response", async () => {
		updateFailures = [json({}, 500)]
		await renderPage()
		expect(formStatus()).toBeUndefined()
		await typeInto(input("#widget-name"), "  Draft name  ")
		await typeInto(input("#color-light-primary-hex"), "#246810")

		await submit(button(t("embedSetup.save")))

		expect(host.querySelector("form [role='alert']")?.textContent).toBe(t("embedSetup.saveError"))
		expect(input("#widget-name").value).toBe("  Draft name  ")
		expect(input("#color-light-primary-hex").value).toBe("#246810")
		expect(button(t("embedSetup.save")).disabled).toBe(false)
		expect(formStatus()).toBeUndefined()

		const detailReadsBeforeSave = requests.filter(({ url, method }) => url === DETAIL_URL && method === "GET").length
		await submit(button(t("embedSetup.save")))
		await settle()
		await settle()

		expect(requests.filter(({ url, method }) => url === DETAIL_URL && method === "GET")).toHaveLength(
			detailReadsBeforeSave + 1,
		)
		expect(updates).toHaveLength(2)
		expect(updates[1]).toEqual({
			name: "Draft name",
			agentId: AGENT_ID,
			appearance: {
				light: {
					primary: "#246810",
					textOnPrimary: "#ffffff",
					background: "#ffffff",
					surface: "#f5f5f5",
					text: "#171717",
				},
				dark: {
					primary: "#34d399",
					textOnPrimary: "#052e16",
					background: "#0a0a0a",
					surface: "#1a1a1a",
					text: "#fafafa",
				},
				position: "bottom-right",
				theme: "system",
				themeToggle: false,
				language: "en",
			},
		})
		expect(input("#widget-name").value).toBe("Saved by server")
		expect(input("#color-light-primary-hex").value).toBe("#abcdef")
		expect(button(t("embedSetup.save")).disabled).toBe(true)
		expect(formStatus()).toBe(t("embedSetup.saved"))

		await typeInto(input("#widget-name"), "Another draft")
		expect(formStatus()).toBeUndefined()
		expect(button(t("embedSetup.save")).disabled).toBe(false)
	})

	test("swaps the save label and keeps it disabled while the update is in flight", async () => {
		const gate = pending()
		updateGate = gate.gate
		await renderPage()
		await typeInto(input("#widget-name"), "Renamed")

		await submit(button(t("embedSetup.save")))

		expect(button(t("embedSetup.saving")).disabled).toBe(true)

		updateGate = undefined
		await act(async () => gate.release())
		await settle()
		await settle()
		await settle()

		expect(input("#widget-name").value).toBe("Saved by server")
		expect(formStatus()).toBe(t("embedSetup.saved"))
	})

	test("keeps a dirty field when a background refetch lands, while updating clean ones", async () => {
		await renderPage()
		await typeInto(input("#widget-name"), "Local draft")
		currentEmbed = {
			...INITIAL_EMBED,
			name: "Renamed elsewhere",
			appearance: { ...INITIAL_EMBED.appearance, light: { ...INITIAL_EMBED.appearance.light, primary: "#abcdef" } },
		}

		await act(async () => {
			await queryClient.refetchQueries({ queryKey: getGetEmbedQueryKey(EMBED_ID) }).catch(() => undefined)
		})
		await settle()

		expect(input("#widget-name").value).toBe("Local draft")
		expect(input("#color-light-primary-hex").value).toBe("#abcdef")
	})

	test("invalidates only the saved embed and the embed list after a save", async () => {
		await renderPage()
		const unrelatedKey = ["unrelated-cache"]
		queryClient.setQueryData(unrelatedKey, { keep: true })
		queryClient.setQueryData(getListEmbedsQueryKey(), { data: { embeds: [INITIAL_EMBED] } })

		await typeInto(input("#widget-name"), "Renamed")
		await submit(button(t("embedSetup.save")))

		expect(updates).toHaveLength(1)
		expect(queryClient.getQueryState(unrelatedKey)?.isInvalidated).toBe(false)
		expect(queryClient.getQueryState(getListEmbedsQueryKey())?.isInvalidated).toBe(true)
		expect(queryClient.getQueryState(getGetEmbedQueryKey(EMBED_ID))?.isInvalidated).toBe(false)
	})
})

describe("embed detail loading", () => {
	test("explains a missing embed without offering a retry", async () => {
		detailFailures = [json({ code: "embed-not-found", type: "https://docs.talqo.chat/problems#embed-not-found" }, 404)]
		await renderPage()

		expect(host.textContent).toContain(t("embedSetup.notFound"))
		expect(host.querySelector("[role='alert']")).toBeNull()
		const backLink = host.querySelector<HTMLAnchorElement>('a[href="/dashboard/agents"]')
		expect(backLink?.textContent).toContain(t("agentConfig.backToAgents"))
	})

	test("shows the loading indicator until the embed arrives", async () => {
		const gate = pending()
		detailGate = gate.gate
		await renderPage()

		expect(host.textContent).toContain(t("embedSetup.loading"))
		expect(host.querySelector("form")).toBeNull()

		detailGate = undefined
		await act(async () => gate.release())
		await settle()
		await settle()

		expect(input("#widget-name").value).toBe(INITIAL_EMBED.name)
	})

	test("shows the loading indicator until the agent permissions arrive", async () => {
		const gate = pending()
		agentsGate = gate.gate
		await renderPage()

		expect(host.textContent).toContain(t("embedSetup.loading"))
		expect(host.querySelector("form")).toBeNull()

		agentsGate = undefined
		await act(async () => gate.release())
		await settle()
		await settle()

		expect(input("#widget-name").value).toBe(INITIAL_EMBED.name)
	})

	test("retries a failed embed load and then renders the form", async () => {
		detailFailures = [json({}, 403)]
		await renderPage()
		await settle()
		await settle()
		expect(host.textContent).toContain(t("embedSetup.detailLoadError"))
		const beforeRetry = requests.filter(({ url, method }) => url === DETAIL_URL && method === "GET").length
		expect(beforeRetry).toBe(1)

		await click(button(t("common.retry")))

		expect(requests.filter(({ url, method }) => url === DETAIL_URL && method === "GET")).toHaveLength(beforeRetry + 1)
		expect(input("#widget-name").value).toBe(INITIAL_EMBED.name)
	})

	test("retries a failed agent permission load before allowing edits", async () => {
		agentsFailures = [json({}, 403)]
		await renderPage()
		await settle()
		await settle()
		expect(host.querySelector("[role='alert']")?.textContent).toContain(t("common.retry"))
		expect(host.querySelector("#widget-name")).toBeNull()
		const beforeRetry = requests.filter(({ url }) => url === "/api/agents").length
		expect(beforeRetry).toBe(1)

		await click(button(t("common.retry")))

		expect(requests.filter(({ url }) => url === "/api/agents")).toHaveLength(beforeRetry + 1)
		expect(input("#widget-name").value).toBe(INITIAL_EMBED.name)
	})

	test("surfaces a failed background refresh and recovers on retry", async () => {
		await renderPage()
		detailFailures = [json({}, 403)]

		await act(async () => {
			await queryClient.refetchQueries({ queryKey: getGetEmbedQueryKey(EMBED_ID) }).catch(() => undefined)
		})
		await settle()

		expect(host.textContent).toContain(t("embedSetup.detailLoadError"))
		expect(host.querySelector("form")).toBeNull()

		await click(button(t("common.retry")))

		expect(input("#widget-name").value).toBe(INITIAL_EMBED.name)
	})

	test("explains when the embed is disabled", async () => {
		currentEmbed = { ...INITIAL_EMBED, isDisabled: true }
		await renderPage()

		expect(host.textContent).toContain(t("embedSetup.embedDisabledNote"))
	})

	test("makes the form and token read-only without manage permission", async () => {
		agentPermissions = ["agents:read"]
		await renderPage()

		expect(input("#widget-name").readOnly).toBe(true)
		expect(input("#color-light-primary-hex").readOnly).toBe(true)
		expect(host.querySelector<HTMLButtonElement>("#widget-position")?.disabled).toBe(true)
		expect(host.querySelector("#embed-token")).toBeNull()
		expect(host.textContent).not.toContain(t("embedSetup.deleteEmbed"))
		expect(
			[...host.querySelectorAll("button")].some((element) => element.textContent?.trim() === t("embedSetup.save")),
		).toBe(false)

		await act(async () => input("#widget-name").form?.requestSubmit())
		await settle()

		expect(requests.filter(({ method }) => method === "PUT")).toHaveLength(0)
	})

	test("treats an embed whose agent is not listed as read-only", async () => {
		includeEmbedAgent = false
		await renderPage()

		expect(input("#widget-name").readOnly).toBe(true)
		expect(host.querySelector("#embed-token")).toBeNull()
		expect(host.textContent).not.toContain(t("embedSetup.deleteEmbed"))
	})
})

describe("embed snippet copying", () => {
	test("shows one feedback window that restarts on repeat copies and clears on failure", async () => {
		const writes: Array<string> = []
		let reject = false
		const restoreClipboard = stubClipboard(async (text) => {
			writes.push(text)
			if (reject) throw new Error("clipboard denied")
		})
		try {
			await renderPage()
			expect(copyIcon()).toBe("copy")

			jest.useFakeTimers()
			await act(async () => button(t("embedSetup.copyEmbed")).click())
			expect(writes).toHaveLength(1)
			expect(copyIcon()).toBe("check")

			await advance(1500)
			expect(copyIcon()).toBe("check")
			await act(async () => button(t("embedSetup.copyEmbed")).click())
			expect(writes).toHaveLength(2)

			await advance(600)
			expect(copyIcon()).toBe("check")

			reject = true
			await act(async () => button(t("embedSetup.copyEmbed")).click())
			expect(writes).toHaveLength(3)
			expect(copyIcon()).toBe("copy")

			reject = false
			await act(async () => button(t("embedSetup.copyEmbed")).click())
			expect(copyIcon()).toBe("check")
			await advance(2000)
			expect(copyIcon()).toBe("copy")
		} finally {
			jest.useRealTimers()
			restoreClipboard()
		}
	})

	test("renders no snippet and copies nothing when the widget CDN URL is empty", async () => {
		const env = import.meta.env as Record<string, string | undefined>
		const configured = env.VITE_WIDGET_CDN_URL
		env.VITE_WIDGET_CDN_URL = ""
		const writes: Array<string> = []
		const restoreClipboard = stubClipboard(async (text) => {
			writes.push(text)
		})
		try {
			await renderPage()

			expect(host.querySelector("pre")?.textContent).toBe("")
			await click(button(t("embedSetup.copyEmbed")))
			expect(writes).toHaveLength(0)
		} finally {
			if (configured === undefined) delete env.VITE_WIDGET_CDN_URL
			else env.VITE_WIDGET_CDN_URL = configured
			restoreClipboard()
		}
	})

	test("writes the current snippet and recovers after a rejected clipboard write", async () => {
		const writes: Array<string> = []
		let reject = true
		const restoreClipboard = stubClipboard(async (text) => {
			writes.push(text)
			if (reject) throw new Error("clipboard denied")
		})
		try {
			await renderPage()
			const copy = t("embedSetup.copyEmbed")

			await click(button(copy))
			expect(writes).toHaveLength(1)

			reject = false
			await click(button(copy))
			expect(writes).toHaveLength(2)
			expect(writes[1]).toContain(`data-talqo-embed-token="${INITIAL_EMBED.embedToken}"`)
			expect(writes[1]).toContain(`${window.location.origin}/widget.js`)
		} finally {
			restoreClipboard()
		}
	})
})

describe("embed appearance controls", () => {
	test("keeps an empty name unsaved and focuses it", async () => {
		await renderPage()
		await typeInto(input("#widget-name"), "")
		input("#widget-name").blur()

		await submit(button(t("embedSetup.save")))

		expect(updates).toHaveLength(0)
		expect(document.activeElement).toBe(input("#widget-name"))
		expect(input("#widget-name").getAttribute("aria-invalid")).toBe("true")
		expect(input("#widget-name").getAttribute("aria-describedby")).toBe("widget-name-error")
		expect(host.querySelector("#widget-name-error")?.textContent).toBe(t("embedSetup.nameRequired"))
	})

	test("keeps the selected color scheme in the URL without adding history entries", async () => {
		const router = await renderPage()
		expect(button(t("embedSetup.tabLight")).getAttribute("aria-selected")).toBe("true")

		await click(button(t("embedSetup.tabDark")))

		expect(router.state.location.search).toEqual({ colorTab: "dark" })
		expect(router.history.length).toBe(1)
		expect(button(t("embedSetup.tabDark")).getAttribute("aria-selected")).toBe("true")
		expect(host.querySelector("#color-dark-primary-hex")).not.toBeNull()
	})

	test("labels the appearance card and every color field", async () => {
		await renderPage()

		const cardTitles = [...host.querySelectorAll('[data-slot="card-title"]')].map((title) => title.textContent)
		expect(cardTitles).toContain(t("embedSetup.appearance"))
		expect(host.textContent).toContain(t("embedSetup.colorsHelp"))
		expect(host.querySelector('label[for="widget-name"]')?.textContent).toBe(t("embedSetup.nameLabel"))
		expect(host.querySelector('label[for="widget-theme-toggle"]')?.textContent).toBe(t("embedSetup.themeToggle"))
		expect(host.querySelector('label[for="color-light-primary"]')?.textContent).toBe(t("embedSetup.colorPrimary"))
		expect(host.querySelector('label[for="color-light-text-on-primary"]')?.textContent).toBe(
			t("embedSetup.colorTextOnPrimary"),
		)
		expect(host.querySelector('label[for="color-light-background"]')?.textContent).toBe(t("embedSetup.colorBackground"))
		expect(host.querySelector('label[for="color-light-surface"]')?.textContent).toBe(t("embedSetup.colorSurface"))
		expect(host.querySelector('label[for="color-light-text"]')?.textContent).toBe(t("embedSetup.colorText"))
	})

	test("saves edits to every color field", async () => {
		await renderPage()
		await typeInto(input("#color-light-text-on-primary-hex"), "#010203")
		await typeInto(input("#color-light-background-hex"), "#111213")
		await typeInto(input("#color-light-surface-hex"), "#212223")
		await typeInto(input("#color-light-text-hex"), "#313233")

		await submit(button(t("embedSetup.save")))

		expect(updates[0]).toEqual({
			name: INITIAL_EMBED.name,
			agentId: AGENT_ID,
			appearance: {
				...INITIAL_EMBED.appearance,
				light: {
					...INITIAL_EMBED.appearance.light,
					textOnPrimary: "#010203",
					background: "#111213",
					surface: "#212223",
					text: "#313233",
				},
			},
		})
	})

	test.each(CONTRAST_CASES)("compares the $field field against its paired color", async ({ field, value }) => {
		await renderPage()

		await typeInto(input(`#color-light-${field}-hex`), value)

		expect(host.querySelector(`#color-light-${field}-contrast`)?.textContent).toBe(t("embedSetup.contrastWarning"))
	})

	test("labels the position, theme, and language selects", async () => {
		await renderPage()

		expect(host.querySelector('label[for="widget-position"]')?.textContent).toBe(t("embedSetup.position"))
		expect(host.querySelector('label[for="widget-theme"]')?.textContent).toBe(t("embedSetup.theme"))
		expect(host.querySelector('label[for="widget-language"]')?.textContent).toBe(t("embedSetup.language"))
	})

	test("keeps the dark scheme editable for managers", async () => {
		await renderPage()
		await click(button(t("embedSetup.tabDark")))

		expect(input("#color-dark-primary-hex").readOnly).toBe(false)
		expect(input("#color-dark-primary").disabled).toBe(false)
	})

	test("saves the selected position, theme, language, and theme toggle", async () => {
		await renderPage()
		expect(host.querySelector("#widget-position")?.textContent).toContain(t("embedSetup.positionBottomRight"))
		expect(host.querySelector("#widget-theme")?.textContent).toContain(t("embedSetup.themeSystem"))
		expect(host.querySelector("#widget-language")?.textContent).toContain(supportedLanguages.en)
		await typeInto(input("#widget-name"), "Storefront")
		await choose("#widget-position", t("embedSetup.positionBottomLeft"))
		await choose("#widget-theme", t("embedSetup.themeDark"))
		await choose("#widget-language", supportedLanguages.cs)
		const themeToggle = host.querySelector<HTMLElement>("[role='switch']")
		if (!themeToggle) throw new Error("Theme toggle not rendered")
		await click(themeToggle)

		await submit(button(t("embedSetup.save")))

		expect(updates).toHaveLength(1)
		expect(updates[0]).toEqual({
			name: "Storefront",
			agentId: AGENT_ID,
			appearance: {
				...INITIAL_EMBED.appearance,
				position: "bottom-left",
				theme: "dark",
				themeToggle: true,
				language: "cs",
			},
		})
	})
})

describe("embed deletion", () => {
	test("keeps failure state intact, then clears cached queries and bypasses the dirty guard", async () => {
		deleteFailures = [json({}, 500)]
		const router = await renderPage()
		const listKey = getListEmbedsQueryKey()
		const detailKey = getGetEmbedQueryKey(EMBED_ID)
		const unrelatedKey = ["unrelated-cache"]
		queryClient.setQueryData(listKey, { data: { embeds: [INITIAL_EMBED] } })
		queryClient.setQueryData(unrelatedKey, { keep: true })
		await typeInto(input("#widget-name"), "Unsaved embed name")
		expect(document.querySelector("[role='alertdialog']")).toBeNull()
		await click(button(t("embedSetup.deleteEmbed")))
		await click(button(t("embedSetup.cancel"), deleteDialog()))
		expect(document.querySelector("[role='alertdialog']")).toBeNull()
		await click(button(t("embedSetup.deleteEmbed")))
		const confirmation = deleteDialog().querySelector("input")
		if (!(confirmation instanceof HTMLInputElement)) throw new Error("Delete confirmation field not rendered")
		await typeInto(confirmation, INITIAL_EMBED.name)

		await click(button(t("embedSetup.deleteConfirm"), deleteDialog()))

		expect(deleteDialog().querySelector("[role='alert']")?.textContent).toBe(t("embedSetup.deleteFailed"))
		expect(input("#widget-name").value).toBe("Unsaved embed name")
		expect(router.state.location.pathname).toBe(`/dashboard/embeds/${EMBED_ID}`)
		expect(queryClient.getQueryData(listKey)).toEqual({ data: { embeds: [INITIAL_EMBED] } })
		expect(queryClient.getQueryData(detailKey)).toMatchObject({ data: { embed: INITIAL_EMBED } })

		await click(button(t("embedSetup.cancel"), deleteDialog()))
		expect(document.querySelector("[role='alertdialog']")).toBeNull()
		await click(button(t("embedSetup.deleteEmbed")))
		expect(deleteDialog().querySelector("[role='alert']")).toBeNull()
		const retriedConfirmation = deleteDialog().querySelector("input")
		if (!(retriedConfirmation instanceof HTMLInputElement)) throw new Error("Delete confirmation field not rendered")
		await typeInto(retriedConfirmation, INITIAL_EMBED.name)

		await click(button(t("embedSetup.deleteConfirm"), deleteDialog()))

		expect(router.state.location.pathname).toBe(`/dashboard/agent/${AGENT_ID}`)
		expect(router.state.location.search).toHaveProperty("tab", "embeds")
		expect(host.querySelector('[data-testid="agent-destination"]')).not.toBeNull()
		expect(document.querySelector("[role='alertdialog']")).toBeNull()
		expect(queryClient.getQueryData(listKey)).toBeUndefined()
		expect(queryClient.getQueryData(detailKey)).toBeUndefined()
		expect(queryClient.getQueryData(unrelatedKey)).toEqual({ keep: true })
	})
})

describe("embed detail chrome", () => {
	test("links back to the owning agent's embed tab", async () => {
		await renderPage()

		const backLink = host.querySelector<HTMLAnchorElement>(`a[href="/dashboard/agent/${AGENT_ID}?tab=embeds"]`)

		expect(backLink?.textContent).toContain(t("embedSetup.backToAgent"))
	})

	test("renders the setup, snippet, token, preview, and danger zone copy", async () => {
		await renderPage()

		expect(host.textContent).toContain(t("embedSetup.detailSubheading"))
		for (const copy of [
			t("embedSetup.embedCode"),
			t("embedSetup.embedDescription"),
			t("embedSetup.appearance"),
			t("embedSetup.appearanceDescription"),
			t("embedSetup.livePreview"),
			t("embedSetup.livePreviewDescription"),
			t("embedSetup.previewSiteLabel"),
			t("embedSetup.embedToken"),
			t("embedSetup.embedTokenDescription"),
			t("embedSetup.dangerZone"),
			t("embedSetup.deleteEmbed"),
			t("embedSetup.dangerDescription"),
		]) {
			expect(host.textContent).toContain(copy)
		}

		const token = input("#embed-token")
		expect(token.value).toBe(INITIAL_EMBED.embedToken)
		expect(token.getAttribute("aria-label")).toBe(t("embedSetup.embedToken"))
		expect(host.querySelector("pre")?.textContent).toContain(`data-talqo-embed-token="${INITIAL_EMBED.embedToken}"`)
	})

	test("opens the full preview for this embed", async () => {
		await renderPage()

		const previewLink = host.querySelector<HTMLAnchorElement>('a[href^="/embed-preview"]')

		expect(previewLink?.getAttribute("href")).toContain(`embed=${EMBED_ID}`)
		expect(previewLink?.getAttribute("aria-label")).toBe(t("embedSetup.openFullPreview"))
		expect(previewLink?.textContent).toContain(t("embedSetup.openFullPreview"))
	})
})
