import type { Embed } from "@/api/generated/models/embed.zod"
import type { QueryClient } from "@/testing/component-harness"
import type { Root } from "react-dom/client"

import {
	json,
	type RecordedRequest as RequestRecord,
	recordRequest,
	requestCount as countRequests,
} from "@/testing/api-responses"
import { act, createTestHarness, QueryClientProvider, settle } from "@/testing/component-harness"
import { click } from "@/testing/dom"
import { afterEach, beforeEach, describe, expect, test } from "bun:test"

const { EMBED_FORM_DEFAULTS } = await import("@/features/embeds/embed-appearance-form")
const { useGetEmbed, useListEmbeds } = await import("@/api/generated/embed/embed.ts")
const { RotateEmbedTokenDialog } = await import("./-rotate-embed-token-dialog")
const { t } = await import("i18next")

const EMBED_ID = "embed-1"
const DETAIL_URL = `/api/embeds/${EMBED_ID}`
const ROTATE_URL = `${DETAIL_URL}/embed-token/rotate`
const INITIAL_EMBED: Embed = {
	id: EMBED_ID,
	agentId: "agent-1",
	name: "Storefront",
	embedToken: "initial-token",
	accessVersion: 1,
	isDisabled: false,
	appearance: EMBED_FORM_DEFAULTS,
}

let currentEmbed: Embed
let rotationFailures: number
let requests: RequestRecord[]
let host: HTMLDivElement
let root: Root
let queryClient: InstanceType<typeof QueryClient>
let harness: ReturnType<typeof createTestHarness>

function TokenRotationHarness() {
	const detail = useGetEmbed(EMBED_ID)
	const list = useListEmbeds()
	return (
		<>
			<output id="detail-token">{detail.data?.data.embed.embedToken}</output>
			<output id="list-token">{list.data?.data.embeds[0]?.embedToken}</output>
			<RotateEmbedTokenDialog embedId={EMBED_ID} />
		</>
	)
}

async function respond(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
	const { url, method } = recordRequest(requests, input, init)
	if (url === DETAIL_URL && method === "GET") return json({ embed: currentEmbed })
	if (url === "/api/embeds" && method === "GET") return json({ embeds: [currentEmbed] })
	if (url === ROTATE_URL && method === "POST") {
		if (rotationFailures > 0) {
			rotationFailures -= 1
			return json({}, 500)
		}
		currentEmbed = { ...currentEmbed, embedToken: "rotated-token", accessVersion: 2 }
		return json({ embed: currentEmbed })
	}
	throw new Error(`Unexpected request ${method} ${url}`)
}

async function renderDialog() {
	await act(async () => {
		root.render(
			<QueryClientProvider client={queryClient}>
				<TokenRotationHarness />
			</QueryClientProvider>,
		)
	})
	await settle()
	await settle()
}

function tokenOutput(id: string): HTMLOutputElement {
	const found = host.querySelector<HTMLOutputElement>(`#${id}`)
	if (!found) throw new Error(`${id} not rendered`)
	return found
}

function dialog(): HTMLElement {
	const found = document.querySelector<HTMLElement>("[role='alertdialog']")
	if (!found) throw new Error("Rotation confirmation not open")
	return found
}

function button(label: string, scope: ParentNode = document): HTMLButtonElement {
	const found = [...scope.querySelectorAll("button")].find((element) => element.textContent?.trim() === label)
	if (!found) throw new Error(`Button "${label}" not rendered`)
	return found
}

function requestCount(url: string, method = "GET"): number {
	return countRequests(requests, url, method)
}

beforeEach(() => {
	currentEmbed = INITIAL_EMBED
	rotationFailures = 0
	requests = []
	harness = createTestHarness({ fetch: respond as typeof fetch })
	;({ host, root, queryClient } = harness)
})

afterEach(async () => {
	await harness.dispose()
	window.localStorage.removeItem("talqo-language")
	document.documentElement.lang = "en"
})

describe("embed token rotation", () => {
	test("keeps a failed confirmation open without refetching, then refreshes both queries on retry", async () => {
		rotationFailures = 1
		await renderDialog()
		expect(tokenOutput("detail-token").textContent).toBe("initial-token")
		expect(tokenOutput("list-token").textContent).toBe("initial-token")
		expect(document.querySelector("[role='alertdialog']") === null).toBe(true)
		await click(button(t("embedSetup.rotateToken"), host))
		await click(button(t("embedSetup.cancel"), dialog()))
		expect(document.querySelector("[role='alertdialog']") === null).toBe(true)
		await click(button(t("embedSetup.rotateToken"), host))
		expect(requestCount(ROTATE_URL, "POST")).toBe(0)
		const detailBeforeRotate = requestCount(DETAIL_URL)
		const listBeforeRotate = requestCount("/api/embeds")

		await click(button(t("embedSetup.rotateToken"), dialog()))

		expect(document.querySelector("[role='alertdialog']")).not.toBeNull()
		expect(dialog().querySelector("[role='alert']")?.textContent).toBe(t("embedSetup.rotateTokenFailed"))
		expect(requestCount(DETAIL_URL)).toBe(detailBeforeRotate)
		expect(requestCount("/api/embeds")).toBe(listBeforeRotate)
		expect(tokenOutput("detail-token").textContent).toBe("initial-token")

		await click(button(t("embedSetup.rotateToken"), dialog()))

		expect(requestCount(ROTATE_URL, "POST")).toBe(2)
		expect(document.querySelector("[role='alertdialog']") === null).toBe(true)
		expect(requestCount(DETAIL_URL)).toBe(detailBeforeRotate + 1)
		expect(requestCount("/api/embeds")).toBe(listBeforeRotate + 1)
		expect(tokenOutput("detail-token").textContent).toBe("rotated-token")
		expect(tokenOutput("list-token").textContent).toBe("rotated-token")
	})
})
