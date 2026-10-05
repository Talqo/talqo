import type { AiProviderConfiguration, ProviderMetadata } from "@/features/ai-configuration/types.ts"
import type { Root } from "react-dom/client"

import { GlobalRegistrator } from "@happy-dom/global-registrator"
import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"

GlobalRegistrator.register({ url: "http://localhost/" })
await import("@/lib/i18n")
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const { AiConfigurationPage } = await import("./ai-configuration-page")
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query")
const { createRoot } = await import("react-dom/client")
const { act } = await import("react")
const { t } = await import("i18next")

const PROVIDER: ProviderMetadata = {
	id: "openai-compatible",
	roles: ["text", "embedding"],
	authModes: ["static"],
	settingFields: ["baseURL"],
	requiredSettingFields: ["baseURL"],
	credentialFields: ["apiKey"],
	requiredCredentialFields: ["apiKey"],
	discovery: true,
}

// Separate embedding credentials keep text edits from opening the re-embed confirmation.
function configuration(revision: number, baseURL: string): AiProviderConfiguration {
	const role = { providerId: "openai-compatible" as const, authMode: "static" as const, hasCredentials: true }
	return {
		revision,
		health: "configured",
		text: { ...role, modelId: "chat-model", settings: { baseURL } },
		embedding: {
			...role,
			modelId: "embedding-model",
			settings: { baseURL: "https://embeddings.example/v1" },
			credentialSource: "separate",
		},
	}
}

let server: AiProviderConfiguration
let host: HTMLDivElement
let root: Root
let queryClient: InstanceType<typeof QueryClient>

function json(body: unknown): Response {
	return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } })
}

async function settle() {
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 0))
	})
}

function baseUrlInput(): HTMLInputElement {
	const element = host.querySelector<HTMLInputElement>("#text-baseURL")
	if (!element) throw new Error("text base URL input not rendered")
	return element
}

async function type(element: HTMLInputElement, text: string) {
	await act(async () => {
		const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
		valueSetter?.call(element, text)
		element.dispatchEvent(new Event("input", { bubbles: true }))
	})
}

async function renderPage() {
	await act(async () =>
		root.render(
			<QueryClientProvider client={queryClient}>
				<AiConfigurationPage />
			</QueryClientProvider>,
		),
	)
	await settle()
}

async function respond(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
	const url = String(input)
	const method = init?.method ?? "GET"
	if (url === "/api/ai-providers") return json({ providers: [PROVIDER] })
	if (url === "/api/ai-provider-models/discover") return json({ models: [] })
	if (url === "/api/ai-provider-configuration" && method === "PUT") {
		// Mimics the server canonicalizing the base URL so the test can see the post-save reset.
		const body = JSON.parse(String(init?.body)) as { text: { settings: { baseURL: string } } }
		server = configuration(server.revision + 1, body.text.settings.baseURL.replace(/\/$/, ""))
		return json(server)
	}
	if (url === "/api/ai-provider-configuration") return json(server)
	throw new Error(`unexpected request ${method} ${url}`)
}

beforeEach(() => {
	server = configuration(1, "https://server.example/v1")
	spyOn(globalThis, "fetch").mockImplementation(respond as typeof fetch)
	queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
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

describe("AiConfigurationPage", () => {
	test("keeps unsaved edits when the configuration refetches unchanged", async () => {
		await renderPage()
		expect(baseUrlInput().value).toBe("https://server.example/v1")

		await type(baseUrlInput(), "https://edited.example/v1")
		await act(() => queryClient.refetchQueries())
		await settle()

		expect(baseUrlInput().value).toBe("https://edited.example/v1")
	})

	test("shows the saved server values after saving", async () => {
		await renderPage()

		await type(baseUrlInput(), "https://saved.example/v1/")
		await act(async () =>
			host.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
		)
		await settle()

		expect(host.textContent).toContain(t("aiConfiguration.saved"))
		expect(baseUrlInput().value).toBe("https://saved.example/v1")
	})
})
