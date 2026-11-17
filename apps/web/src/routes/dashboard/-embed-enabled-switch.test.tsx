import type { Embed } from "@/api/generated/models/embed.zod"
import type { Root } from "react-dom/client"

import { GlobalRegistrator } from "@happy-dom/global-registrator"
import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register({ url: "http://localhost/" })
await import("@/lib/i18n")
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

import {
	json,
	problem,
	type RecordedRequest as RequestRecord,
	recordRequest,
	requestCount as countRequests,
} from "@/testing/api-responses"
import { settle } from "@/testing/component-harness"
import { click } from "@/testing/dom"

const { EMBED_FORM_DEFAULTS } = await import("@/features/embeds/embed-appearance-form")
const { useGetEmbed, useListEmbeds } = await import("@/api/generated/embed/embed.ts")
const { EmbedEnabledSwitch } = await import("./-embed-enabled-switch")
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query")
const { createRoot } = await import("react-dom/client")
const { act } = await import("react")
const { default: i18n, t } = await import("i18next")

const EMBED_ID = "embed-1"
const AGENT_ID = "agent-1"
const OTHER_AGENT_ID = "agent-2"
const DETAIL_URL = `/api/embeds/${EMBED_ID}`
const AGENT_LIST_URL = `/api/embeds?agentId=${AGENT_ID}`
const OTHER_AGENT_LIST_URL = `/api/embeds?agentId=${OTHER_AGENT_ID}`
const INITIAL_EMBED: Embed = {
	id: EMBED_ID,
	agentId: AGENT_ID,
	name: "Storefront",
	embedToken: "embed-token",
	accessVersion: 1,
	isDisabled: false,
	appearance: EMBED_FORM_DEFAULTS,
}
const OTHER_AGENT_EMBED: Embed = { ...INITIAL_EMBED, id: "embed-2", agentId: OTHER_AGENT_ID }
const SCENARIOS = [
	{
		action: "disable",
		initialDisabled: false,
		resultingDisabled: true,
		error: "Could not disable the embed. Try again.",
	},
	{
		action: "enable",
		initialDisabled: true,
		resultingDisabled: false,
		error: "Could not enable the embed. Try again.",
	},
] as const

let currentEmbed: Embed
let mutationFailures: Response[]
let mutationResponse: Promise<Response> | undefined
let requests: RequestRecord[]
let host: HTMLDivElement
let root: Root
let queryClient: InstanceType<typeof QueryClient>

function SwitchHarness({ initialDisabled, disabled = false }: { initialDisabled: boolean; disabled?: boolean }) {
	const detail = useGetEmbed(EMBED_ID)
	const list = useListEmbeds({ agentId: AGENT_ID })
	useListEmbeds({ agentId: OTHER_AGENT_ID })
	const embed = list.data?.data.embeds[0] ?? { ...INITIAL_EMBED, isDisabled: initialDisabled }
	return (
		<>
			<output id="detail-disabled">{String(detail.data?.data.embed.isDisabled)}</output>
			<EmbedEnabledSwitch embed={embed} disabled={disabled} />
		</>
	)
}

async function respond(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
	const { url, method } = recordRequest(requests, input, init)
	if (url === DETAIL_URL && method === "GET") return json({ embed: currentEmbed })
	if (url === AGENT_LIST_URL && method === "GET") return json({ embeds: [currentEmbed] })
	if (url === OTHER_AGENT_LIST_URL && method === "GET") return json({ embeds: [OTHER_AGENT_EMBED] })
	if ((url === `${DETAIL_URL}/disable` || url === `${DETAIL_URL}/enable`) && method === "POST") {
		if (mutationResponse) return mutationResponse
		const failure = mutationFailures.shift()
		if (failure) return failure
		currentEmbed = { ...currentEmbed, isDisabled: url.endsWith("/disable") }
		return json({ embed: currentEmbed })
	}
	throw new Error(`Unexpected request ${method} ${url}`)
}

async function renderSwitch(initialDisabled: boolean, disabled = false) {
	currentEmbed = { ...INITIAL_EMBED, isDisabled: initialDisabled }
	await act(async () => {
		root.render(
			<QueryClientProvider client={queryClient}>
				<SwitchHarness initialDisabled={initialDisabled} disabled={disabled} />
			</QueryClientProvider>,
		)
	})
	await settle()
	await settle()
}

function enabledSwitch(): HTMLElement {
	const found = host.querySelector<HTMLButtonElement>("[role='switch']")
	if (!found) throw new Error("Embed enabled switch not rendered")
	return found
}

function enabledInput(): HTMLInputElement {
	const input = host.querySelector<HTMLInputElement>('input[type="checkbox"]')
	if (!input) throw new Error("Embed enabled checkbox not rendered")
	return input
}

function detailDisabled(): string | null {
	return host.querySelector("#detail-disabled")?.textContent ?? null
}

function requestCount(url: string, method = "GET"): number {
	return countRequests(requests, url, method)
}

beforeEach(async () => {
	mutationFailures = []
	mutationResponse = undefined
	requests = []
	spyOn(globalThis, "fetch").mockImplementation(respond as typeof fetch)
	queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
	host = document.createElement("div")
	document.body.append(host)
	root = createRoot(host)
	window.localStorage.removeItem("talqo-language")
	await i18n.changeLanguage("en")
})

afterEach(async () => {
	await act(async () => root.unmount())
	host.remove()
	queryClient.clear()
	mock.restore()
	window.localStorage.removeItem("talqo-language")
	document.documentElement.lang = "en"
	await i18n.changeLanguage("en")
})

describe("embed enabled switch", () => {
	for (const scenario of SCENARIOS) {
		test(`${scenario.action} failure preserves queries and a retry refreshes only the affected queries`, async () => {
			mutationFailures = [problem("internal-server-error", 500)]
			await renderSwitch(scenario.initialDisabled)
			const detailBefore = requestCount(DETAIL_URL)
			const agentListBefore = requestCount(AGENT_LIST_URL)
			const otherAgentListBefore = requestCount(OTHER_AGENT_LIST_URL)
			const otherAction = scenario.action === "disable" ? "enable" : "disable"

			await click(enabledSwitch())

			expect(requestCount(`${DETAIL_URL}/${scenario.action}`, "POST")).toBe(1)
			expect(requestCount(`${DETAIL_URL}/${otherAction}`, "POST")).toBe(0)
			expect(host.querySelector("[role='alert']")?.textContent).toBe(scenario.error)
			expect(enabledSwitch().getAttribute("aria-checked")).toBe(String(!scenario.initialDisabled))
			expect(requestCount(DETAIL_URL)).toBe(detailBefore)
			expect(requestCount(AGENT_LIST_URL)).toBe(agentListBefore)
			expect(requestCount(OTHER_AGENT_LIST_URL)).toBe(otherAgentListBefore)

			const retry = Promise.withResolvers<Response>()
			mutationResponse = retry.promise
			await click(enabledSwitch())
			expect(enabledInput().disabled).toBe(true)
			expect(host.querySelector("[role='alert']")).toBeNull()

			await click(enabledSwitch())
			expect(requestCount(`${DETAIL_URL}/${scenario.action}`, "POST")).toBe(2)
			currentEmbed = { ...currentEmbed, isDisabled: scenario.resultingDisabled }
			await act(async () => retry.resolve(json({ embed: currentEmbed })))
			mutationResponse = undefined
			await settle()
			await settle()
			expect(host.querySelector("[role='alert']")).toBeNull()
			expect(detailDisabled()).toBe(String(scenario.resultingDisabled))
			expect(enabledSwitch().getAttribute("aria-checked")).toBe(String(!scenario.resultingDisabled))
			expect(requestCount(DETAIL_URL)).toBe(detailBefore + 1)
			expect(requestCount(AGENT_LIST_URL)).toBe(agentListBefore + 1)
			expect(requestCount(OTHER_AGENT_LIST_URL)).toBe(otherAgentListBefore)
		})
	}

	test("is read-only and keeps the embed name in its accessible label when externally disabled", async () => {
		await renderSwitch(false, true)
		expect(enabledInput().disabled).toBe(true)
		expect(enabledSwitch().getAttribute("aria-label")).toBe(
			t("embedSetup.embedEnabledFor", { name: INITIAL_EMBED.name }),
		)

		await click(enabledSwitch())
		expect(requestCount(`${DETAIL_URL}/disable`, "POST")).toBe(0)
		expect(requestCount(`${DETAIL_URL}/enable`, "POST")).toBe(0)
	})

	test("explains when the embed no longer exists", async () => {
		mutationFailures = [problem("embed-not-found", 404)]
		await renderSwitch(false)

		await click(enabledSwitch())

		expect(host.querySelector("[role='alert']")?.textContent).toBe("Embed not found. It may have been removed.")
	})
})
