import type { AgentWebsite } from "@/api/generated/models/agentWebsite.zod"
import type { QueryClient } from "@/testing/component-harness"
import type { QueryObserverOptions } from "@tanstack/react-query"

import { json } from "@/testing/api-responses"
import { act, createTestHarness, QueryClientProvider, type Root } from "@/testing/component-harness"
import { afterEach, beforeEach, describe, expect, test } from "bun:test"

const { AgentWebsitesCard } = await import("./agent-websites-card")
const { LanguageProvider } = await import("@/lib/use-language")
const { t } = await import("i18next")

const WEBSITES_URL = "/api/agents/agent-1/websites"
const WEBSITE_URL = "https://example.com/docs/"
const WEBSITE: AgentWebsite = {
	id: "123e4567-e89b-12d3-a456-426614174000",
	url: WEBSITE_URL,
	createdAt: "2026-10-01T10:00:00.000Z",
	embeddingStatus: "ready",
	embeddingError: null,
}

type Operation = { url: string; method: string; body?: unknown }

let websites: AgentWebsite[]
let listRequests: number
let listFailures: Response[]
let operations: Operation[]
let operationResponses: Array<Response | Promise<Response>>
let harness: ReturnType<typeof createTestHarness>
let host: HTMLDivElement
let root: Root
let queryClient: InstanceType<typeof QueryClient>

async function respond(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
	const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
	const method = init?.method ?? "GET"
	if (url === WEBSITES_URL && method === "GET") {
		listRequests++
		const failure = listFailures.shift()
		if (failure) return failure
		return json({ websites, maxPages: 50 })
	}
	if (url === WEBSITES_URL || url.startsWith(`${WEBSITES_URL}/`)) {
		const body = typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : undefined
		operations.push({ url, method, body })
		const response = operationResponses.shift()
		if (!response) throw new Error(`Unexpected website operation ${method} ${url}`)
		return response
	}
	throw new Error(`Unexpected request ${method} ${url}`)
}

async function settle() {
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 0))
	})
}

async function renderCard(canManage = false) {
	await act(async () =>
		root.render(
			<QueryClientProvider client={queryClient}>
				<LanguageProvider>
					<AgentWebsitesCard agentId="agent-1" canManage={canManage} />
				</LanguageProvider>
			</QueryClientProvider>,
		),
	)
	await settle()
}

function element<T extends Element>(selector: string): T {
	const found = document.querySelector<T>(selector)
	if (!found) throw new Error(`${selector} not rendered`)
	return found
}

function labelledButton(label: string): HTMLButtonElement {
	return element<HTMLButtonElement>(`button[aria-label="${label}"]`)
}

function buttonByText(label: string, scope: ParentNode = host): HTMLButtonElement {
	const found = [...scope.querySelectorAll<HTMLButtonElement>("button")].find(
		(candidate) => candidate.textContent?.trim() === label,
	)
	if (!found) throw new Error(`${label} not rendered`)
	return found
}

async function click(target: HTMLElement) {
	await act(async () => target.click())
	await settle()
	await settle()
}

async function replaceInputValue(input: HTMLInputElement, value: string) {
	await act(async () => {
		const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
		valueSetter?.call(input, value)
		input.dispatchEvent(new Event("input", { bubbles: true }))
	})
}

function currentRefetchInterval(): number | false | undefined {
	const query = queryClient.getQueryCache().find({ queryKey: [WEBSITES_URL] })
	if (!query) throw new Error("websites query not registered")
	const { refetchInterval } = query.options as QueryObserverOptions
	return typeof refetchInterval === "function" ? refetchInterval(query) : refetchInterval
}

beforeEach(() => {
	websites = []
	listRequests = 0
	listFailures = []
	operations = []
	operationResponses = []
	harness = createTestHarness({ fetch: respond as typeof fetch })
	;({ host, root, queryClient } = harness)
})

afterEach(async () => {
	await harness.dispose()
})

describe("AgentWebsitesCard for a read-only operator", () => {
	test("lists normalized sources and safe status detail without management controls", async () => {
		websites = [{ ...WEBSITE, embeddingStatus: "failed", embeddingError: "website-blocked" }]
		await renderCard()

		const source = element<HTMLAnchorElement>(`a[href="${WEBSITE_URL}"]`)
		expect(source.textContent).toBe(WEBSITE_URL)
		expect(source.target).toBe("_blank")
		expect(source.rel).toContain("noreferrer")
		expect(host.textContent).toContain(t("agentWebsites.status.failed"))
		expect(host.textContent).toContain(t("agentWebsites.error.websiteBlocked"))
		expect(host.querySelector("#agent-website-url")).toBeNull()
		expect(host.textContent).not.toContain(t("agentWebsites.addAction"))
		expect(host.querySelector(`button[aria-label="${t("agentWebsites.retry", { url: WEBSITE_URL })}"]`)).toBeNull()
		expect(host.querySelector(`button[aria-label="${t("agentWebsites.delete", { url: WEBSITE_URL })}"]`)).toBeNull()
	})

	test("shows readers an empty state", async () => {
		await renderCard()
		expect(host.textContent).toContain(t("agentWebsites.emptyTitle"))
		expect(host.textContent).toContain(t("agentWebsites.emptyDescriptionReader"))
	})
})

describe("AgentWebsitesCard for a managing operator", () => {
	test("polls only while a website is active", async () => {
		websites = [{ ...WEBSITE, embeddingStatus: "pending" }]
		await renderCard(true)
		expect(currentRefetchInterval()).toBe(3_000)

		websites = [{ ...WEBSITE, embeddingStatus: "processing" }]
		await act(() => queryClient.refetchQueries({ queryKey: [WEBSITES_URL] }))
		expect(currentRefetchInterval()).toBe(3_000)

		websites = [{ ...WEBSITE, embeddingStatus: "failed", embeddingError: "website-unreachable" }]
		await act(() => queryClient.refetchQueries({ queryKey: [WEBSITES_URL] }))
		expect(currentRefetchInterval()).toBe(false)
	})

	test("adds the trimmed URL, keeps a problem response visible, and invalidates after success", async () => {
		operationResponses = [
			json({ code: "agent-website-duplicate", type: "https://docs.talqo.chat/problems#agent-website-duplicate" }, 409),
			json({ website: { ...WEBSITE, embeddingStatus: "pending" } }, 201),
		]
		await renderCard(true)
		const input = element<HTMLInputElement>("#agent-website-url")
		await replaceInputValue(input, `  ${WEBSITE_URL}  `)

		await click(buttonByText(t("agentWebsites.addAction")))

		expect(element<HTMLElement>('[role="alert"]').textContent).toBe(t("problems.agent-website-duplicate"))
		expect(input.value).toBe(WEBSITE_URL)
		expect(listRequests).toBe(1)
		websites = [{ ...WEBSITE, embeddingStatus: "pending" }]

		await click(buttonByText(t("agentWebsites.addAction")))

		expect(input.value).toBe("")
		expect(host.querySelector('[role="alert"]')).toBeNull()
		expect(operations).toEqual([
			{ url: WEBSITES_URL, method: "POST", body: { url: WEBSITE_URL } },
			{ url: WEBSITES_URL, method: "POST", body: { url: WEBSITE_URL } },
		])
		expect(listRequests).toBe(2)
		expect(host.textContent).toContain(t("agentWebsites.status.pending"))
		expect(host.textContent).toContain(t("agentWebsites.cardDescription", { maxPages: 50 }))
	})

	test("refreshes a ready website and retries a failed website through the same endpoint", async () => {
		websites = [WEBSITE]
		operationResponses = [new Response(null, { status: 204 }), new Response(null, { status: 204 })]
		await renderCard(true)
		await click(labelledButton(t("agentWebsites.refresh", { url: WEBSITE_URL })))

		expect(operations).toEqual([{ url: `${WEBSITES_URL}/${WEBSITE.id}/refresh`, method: "POST" }])
		expect(listRequests).toBe(2)

		websites = [{ ...WEBSITE, embeddingStatus: "failed", embeddingError: "website-unreachable" }]
		await act(() => queryClient.refetchQueries({ queryKey: [WEBSITES_URL] }))
		await settle()
		await click(labelledButton(t("agentWebsites.retry", { url: WEBSITE_URL })))
		expect(operations[1]).toEqual({ url: `${WEBSITES_URL}/${WEBSITE.id}/refresh`, method: "POST" })
		expect(listRequests).toBe(4)
	})

	test("shows a safe refresh problem without invalidating a failed mutation", async () => {
		websites = [WEBSITE]
		operationResponses = [
			json(
				{ code: "agent-website-not-refreshable", type: "https://docs.talqo.chat/problems#agent-website-not-refreshable" },
				409,
			),
		]
		await renderCard(true)

		await click(labelledButton(t("agentWebsites.refresh", { url: WEBSITE_URL })))

		expect(host.querySelector('[role="alert"]')?.textContent).toBe(t("problems.agent-website-not-refreshable"))
		expect(listRequests).toBe(1)
	})

	test("holds a failed deletion open, shows recovery guidance, and invalidates after confirmation", async () => {
		websites = [WEBSITE]
		operationResponses = [json({}, 500), new Response(null, { status: 204 })]
		await renderCard(true)
		await click(labelledButton(t("agentWebsites.delete", { url: WEBSITE_URL })))
		const dialog = element<HTMLElement>('[role="alertdialog"]')
		expect(dialog.textContent).toContain(t("agentWebsites.deletePrompt"))
		expect(dialog.textContent).toContain(WEBSITE_URL)

		await click(buttonByText(t("agentWebsites.deleteConfirm"), dialog))
		expect(element<HTMLElement>('[role="alertdialog"] [role="alert"]').textContent).toBe(t("agentWebsites.deleteFailed"))
		expect(listRequests).toBe(1)

		websites = []
		await click(buttonByText(t("agentWebsites.deleteConfirm"), element<HTMLElement>('[role="alertdialog"]')))
		expect(document.querySelector('[role="alertdialog"]')).toBeNull()
		expect(operations).toEqual([
			{ url: `${WEBSITES_URL}/${WEBSITE.id}`, method: "DELETE" },
			{ url: `${WEBSITES_URL}/${WEBSITE.id}`, method: "DELETE" },
		])
		expect(listRequests).toBe(2)
	})

	test("retries a failed website list", async () => {
		listFailures = [json({}, 500)]
		await renderCard(true)
		expect(host.querySelector('[role="alert"]')).not.toBeNull()

		await click(element<HTMLButtonElement>('[role="alert"] button'))

		expect(listRequests).toBe(2)
		expect(host.querySelector('[role="alert"]')).toBeNull()
	})
})
