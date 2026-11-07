import type {
	AiProviderConfiguration,
	ProviderMetadata,
	SaveAiProviderConfigurationInput,
} from "@/features/ai-configuration/types.ts"
import type { Root } from "react-dom/client"

import { GlobalRegistrator } from "@happy-dom/global-registrator"
import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"

// Component test files share one process, so only the first one registers the DOM.
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register({ url: "http://localhost/" })
await import("@/lib/i18n")
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const { AiConfigurationPage } = await import("./ai-configuration-page")
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query")
const { createRouter, createRootRoute, createMemoryHistory, RouterProvider } = await import("@tanstack/react-router")
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
function configuration(
	revision: number,
	baseURL: string,
	embeddingBaseURL = "https://embeddings.example/v1",
): AiProviderConfiguration {
	const role = { providerId: "openai-compatible" as const, authMode: "static" as const, hasCredentials: true }
	return {
		revision,
		health: "configured",
		text: { ...role, modelId: "chat-model", settings: { baseURL } },
		embedding: {
			...role,
			modelId: "embedding-model",
			settings: { baseURL: embeddingBaseURL },
			credentialSource: "separate",
		},
	}
}

let server: AiProviderConfiguration
let host: HTMLDivElement
let root: Root
let queryClient: InstanceType<typeof QueryClient>
let saveRequests: SaveAiProviderConfigurationInput[]
let saveResponse: Promise<Response> | undefined
let configurationRequests: number

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
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

function embeddingBaseUrlInput(): HTMLInputElement {
	const element = host.querySelector<HTMLInputElement>("#embedding-baseURL")
	if (!element) throw new Error("embedding base URL input not rendered")
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
	const route = createRootRoute({ component: () => <AiConfigurationPage /> })
	const router = createRouter({ routeTree: route, history: createMemoryHistory() })
	await act(async () =>
		root.render(
			<QueryClientProvider client={queryClient}>
				<RouterProvider router={router} />
			</QueryClientProvider>,
		),
	)
	await settle()
}

function button(label: string, parent: ParentNode = host): HTMLButtonElement {
	const found = [...parent.querySelectorAll("button")].find((element) => element.textContent === label)
	if (!found) throw new Error(`button ${label} not rendered`)
	return found
}

function confirmationDialog(): HTMLElement {
	const element = document.querySelector<HTMLElement>("[role=dialog]")
	if (!element) throw new Error("confirmation dialog not rendered")
	return element
}

function submit() {
	return act(async () =>
		host.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
	)
}

async function respond(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
	const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
	const method = init?.method ?? "GET"
	if (url === "/api/ai-providers") return json({ providers: [PROVIDER] })
	if (url === "/api/ai-provider-models/discover") return json({ models: [] })
	if (url === "/api/ai-provider-configuration" && method === "PUT") {
		// Mimics the server canonicalizing base URLs so tests can see the post-save reset.
		const body = JSON.parse(
			typeof init?.body === "string" ? init.body : JSON.stringify(init?.body ?? null),
		) as SaveAiProviderConfigurationInput
		if (typeof body.text.settings.baseURL !== "string" || typeof body.embedding.settings.baseURL !== "string") {
			throw new Error("save request must include both base URLs")
		}
		saveRequests.push(body)
		if (saveResponse) {
			const response = saveResponse
			saveResponse = undefined
			return response
		}
		server = configuration(
			server.revision + 1,
			body.text.settings.baseURL.replace(/\/$/, ""),
			body.embedding.settings.baseURL.replace(/\/$/, ""),
		)
		return json(server)
	}
	if (url === "/api/ai-provider-configuration") {
		configurationRequests += 1
		return json(server)
	}
	throw new Error(`unexpected request ${method} ${url}`)
}

beforeEach(() => {
	server = configuration(1, "https://server.example/v1")
	saveRequests = []
	saveResponse = undefined
	configurationRequests = 0
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
		await submit()
		await settle()

		expect(host.textContent).toContain(t("aiConfiguration.saved"))
		expect(baseUrlInput().value).toBe("https://saved.example/v1")
	})

	test("requires confirmation for embedding changes and preserves the draft on cancel", async () => {
		await renderPage()
		const editedBaseURL = "https://draft-embeddings.example/v1"

		await type(embeddingBaseUrlInput(), editedBaseURL)
		await submit()
		await settle()

		expect(confirmationDialog().textContent).toContain(t("aiConfiguration.reembedTitle"))
		expect(saveRequests).toHaveLength(0)
		expect(embeddingBaseUrlInput().value).toBe(editedBaseURL)

		await act(async () => button(t("aiConfiguration.reembedCancel"), confirmationDialog()).click())
		await settle()

		expect(document.querySelector("[role=dialog]") === null).toBe(true)
		expect(saveRequests).toHaveLength(0)
		expect(embeddingBaseUrlInput().value).toBe(editedBaseURL)
	})

	test("requires re-embedding confirmation when only the embedding model changes", async () => {
		await renderPage()
		const embeddingModel = host.querySelector<HTMLInputElement>("#embedding-model")
		if (!embeddingModel) throw new Error("embedding model input not rendered")

		await type(embeddingModel, "embedding-model-next")
		await submit()
		await settle()

		expect(confirmationDialog().textContent).toContain(t("aiConfiguration.reembedTitle"))
		expect(confirmationDialog().textContent).toContain(t("aiConfiguration.reembedWarning"))
		expect(saveRequests).toHaveLength(0)
		expect(embeddingModel.value).toBe("embedding-model-next")
	})

	test("keeps a failed confirmed save open and retries the pending values", async () => {
		await renderPage()
		const editedBaseURL = "https://saved-embeddings.example/v1/"
		await type(embeddingBaseUrlInput(), editedBaseURL)
		await submit()
		await settle()
		expect(saveRequests).toHaveLength(0)

		const initialConfigurationRequests = configurationRequests
		const firstSave = Promise.withResolvers<Response>()
		saveResponse = firstSave.promise
		const expectedSave: SaveAiProviderConfigurationInput = {
			expectedRevision: 1,
			text: {
				providerId: "openai-compatible",
				authMode: "static",
				modelId: "chat-model",
				settings: { baseURL: "https://server.example/v1" },
			},
			embedding: {
				providerId: "openai-compatible",
				authMode: "static",
				modelId: "embedding-model",
				settings: { baseURL: editedBaseURL },
				credentialSource: "separate",
			},
		}

		await act(async () => button(t("aiConfiguration.reembedConfirm"), confirmationDialog()).click())
		await settle()

		expect(saveRequests).toEqual([expectedSave])
		expect(configurationRequests).toBe(initialConfigurationRequests)
		expect(embeddingBaseUrlInput().value).toBe(editedBaseURL)

		await act(async () => {
			button(t("aiConfiguration.reembedCancel"), confirmationDialog()).click()
			button(t("common.close"), confirmationDialog()).click()
		})
		await settle()

		expect(confirmationDialog().textContent).toContain(t("aiConfiguration.reembedTitle"))
		expect(saveRequests).toEqual([expectedSave])
		expect(embeddingBaseUrlInput().value).toBe(editedBaseURL)

		await act(async () => {
			firstSave.resolve(json({}, 500))
			await Promise.resolve()
		})
		await settle()

		expect(confirmationDialog().querySelector("[role=alert]")?.textContent).toBe(t("aiConfiguration.saveFailed"))
		expect(configurationRequests).toBe(initialConfigurationRequests)
		expect(saveRequests).toEqual([expectedSave])
		expect(embeddingBaseUrlInput().value).toBe(editedBaseURL)

		await act(async () => button(t("aiConfiguration.reembedConfirm"), confirmationDialog()).click())
		await settle()

		expect(saveRequests).toEqual([expectedSave, expectedSave])
		expect(configurationRequests).toBe(initialConfigurationRequests + 1)
		expect(document.querySelector("[role=dialog]") === null).toBe(true)
		expect(host.textContent).toContain(t("aiConfiguration.saved"))
		expect(embeddingBaseUrlInput().value).toBe("https://saved-embeddings.example/v1")
	})

	test("associates a missing model with its field and focuses it", async () => {
		await renderPage()
		const model = host.querySelector<HTMLInputElement>("#text-model")
		if (!model) throw new Error("text model input not rendered")

		await type(model, "")
		await submit()
		await settle()

		const error = host.querySelector<HTMLElement>("#text-model-error")
		expect(error?.textContent).toBe(t("aiConfiguration.fields.modelRequired"))
		expect(error?.getAttribute("role")).toBe("alert")
		expect(model.getAttribute("aria-invalid")).toBe("true")
		expect(model.getAttribute("aria-describedby")).toBe("text-model-error")
		expect(document.activeElement === model).toBe(true)
	})

	test("associates a missing required setting with its field and focuses it", async () => {
		await renderPage()
		const baseUrl = baseUrlInput()
		await type(baseUrl, "")
		await submit()
		await settle()

		const error = host.querySelector<HTMLElement>("#text-baseURL-error")
		expect(error?.textContent).toBe(t("aiConfiguration.fields.fieldRequired"))
		expect(baseUrl.getAttribute("aria-invalid")).toBe("true")
		expect(baseUrl.getAttribute("aria-describedby")).toBe("text-baseURL-error")
		expect(document.activeElement?.id).toBe("text-baseURL")
	})

	test("marks providers and models as required", async () => {
		await renderPage()

		expect(host.querySelector("#text-provider")?.getAttribute("aria-required")).toBe("true")
		expect(host.querySelector("#text-model")?.hasAttribute("required")).toBe(true)
		expect(host.textContent).toContain(t("common.requiredHint"))
	})

	test("returns Replace mode to the saved credentials after a successful save", async () => {
		await renderPage()
		await act(async () => button(t("aiConfiguration.replaceCredentials")).click())
		await settle()

		const apiKey = host.querySelector<HTMLInputElement>("#text-apiKey")
		if (!apiKey) throw new Error("credential input not rendered")
		await type(apiKey, "sk-new")
		await submit()
		await settle()

		expect(host.querySelector("#text-apiKey") === null).toBe(true)
		expect(host.textContent).toContain(t("aiConfiguration.savedCredentials"))
	})
})
