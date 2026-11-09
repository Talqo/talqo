import type {
	AiProviderConfiguration,
	ProviderMetadata,
	RedactedRoleConfiguration,
	SaveAiProviderConfigurationInput,
} from "@/features/ai-configuration/types.ts"
import type { QueryClient } from "@/testing/component-harness"

import { json } from "@/testing/api-responses"
import { act, createTestHarness, QueryClientProvider, type Root, settle } from "@/testing/component-harness"
import { afterEach, beforeEach, describe, expect, test } from "bun:test"

const { AiConfigurationPage } = await import("./ai-configuration-page")
const { createRouter, createRootRoute, createMemoryHistory, RouterProvider } = await import("@tanstack/react-router")
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

const OPENAI: ProviderMetadata = {
	id: "openai",
	roles: ["text", "embedding"],
	authModes: ["static", "deployment-identity"],
	settingFields: ["baseURL", "project"],
	requiredSettingFields: ["baseURL"],
	credentialFields: ["apiKey"],
	requiredCredentialFields: ["apiKey"],
	discovery: true,
}

const BEDROCK: ProviderMetadata = {
	id: "amazon-bedrock",
	roles: ["text"],
	authModes: ["static", "deployment-identity"],
	settingFields: ["region"],
	requiredSettingFields: ["region"],
	credentialFields: ["accessKeyId", "secretAccessKey", "sessionToken"],
	requiredCredentialFields: ["accessKeyId", "secretAccessKey"],
	discovery: false,
}

function roleConfiguration(
	providerId: ProviderMetadata["id"],
	modelId: string,
	settings: Record<string, string>,
	hasCredentials = true,
): RedactedRoleConfiguration {
	return { providerId, modelId, authMode: "static", settings, hasCredentials }
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
let providers: ProviderMetadata[]
let host: HTMLDivElement
let root: Root
let queryClient: InstanceType<typeof QueryClient>
let harness: ReturnType<typeof createTestHarness>
let saveRequests: SaveAiProviderConfigurationInput[]
let saveResponse: Promise<Response> | undefined
let configurationRequests: number
let providersFailure: Response | undefined

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

async function choose(id: string, label: string) {
	const trigger = document.getElementById(id)
	if (!trigger) throw new Error(`${id} trigger not rendered`)
	await act(async () => trigger.click())
	await settle()
	const popup = [...document.querySelectorAll("[data-slot=select-content]")].at(-1) ?? document
	const option = [...popup.querySelectorAll<HTMLElement>("[role=option]")].find(
		(element) => element.textContent?.trim() === label,
	)
	if (!option) throw new Error(`${label} option not rendered`)
	await act(async () => option.click())
	await settle()
}

function triggerText(id: string): string | undefined {
	return document.getElementById(id)?.textContent?.trim()
}

function savedCredentialSections(): Element[] {
	return [...host.querySelectorAll("p")].filter(
		(element) => element.textContent?.trim() === t("aiConfiguration.savedCredentials"),
	)
}

function inputById(id: string): HTMLInputElement {
	const element = document.getElementById(id)
	if (!(element instanceof HTMLInputElement)) throw new Error(`${id} input not rendered`)
	return element
}

function tab(label: string): HTMLElement {
	const element = [...host.querySelectorAll<HTMLElement>("[role=tab]")].find(
		(candidate) => candidate.textContent?.trim() === label,
	)
	if (!element) throw new Error(`${label} tab not rendered`)
	return element
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

function canonicalSettings(settings: Record<string, string>): Record<string, string> {
	return Object.fromEntries(Object.entries(settings).map(([key, value]) => [key, value.replace(/\/$/, "")]))
}

function savedRole(
	input: SaveAiProviderConfigurationInput["text"],
	previous: RedactedRoleConfiguration | null,
): RedactedRoleConfiguration {
	const hasCredentials =
		input.authMode === "static"
			? Boolean(input.credentials && Object.keys(input.credentials).length > 0) ||
				Boolean(
					previous?.hasCredentials && previous.providerId === input.providerId && previous.authMode === input.authMode,
				)
			: false
	return {
		providerId: input.providerId,
		modelId: input.modelId,
		authMode: input.authMode,
		settings: canonicalSettings(input.settings),
		hasCredentials,
	}
}

async function respond(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
	const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
	const method = init?.method ?? "GET"
	if (url === "/api/ai-providers") return providersFailure ?? json({ providers })
	if (url === "/api/ai-provider-models/discover") return json({ models: [] })
	if (url === "/api/ai-provider-configuration" && method === "PUT") {
		const body = JSON.parse(
			typeof init?.body === "string" ? init.body : JSON.stringify(init?.body ?? null),
		) as SaveAiProviderConfigurationInput
		saveRequests.push(body)
		if (saveResponse) {
			const response = saveResponse
			saveResponse = undefined
			return response
		}
		const text = savedRole(body.text, server.text)
		server = {
			revision: server.revision + 1,
			health: "configured",
			text,
			embedding: {
				...savedRole(body.embedding, server.embedding),
				credentialSource: body.embedding.credentialSource,
			},
		}
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
	providers = [PROVIDER]
	saveRequests = []
	saveResponse = undefined
	configurationRequests = 0
	providersFailure = undefined
	harness = createTestHarness({ fetch: respond as typeof fetch })
	;({ host, root, queryClient } = harness)
})

afterEach(async () => {
	await harness.dispose()
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
		const save = button(t("aiConfiguration.save"))
		expect(save.disabled).toBe(true)
		await type(baseUrlInput(), "https://edited.example/v1")
		expect(save.disabled).toBe(false)
	})

	test("returns Replace mode to the saved credentials after a successful save", async () => {
		await renderPage()
		await act(async () => button(t("aiConfiguration.replaceCredentials")).click())
		await settle()

		const apiKey = host.querySelector<HTMLInputElement>("#text-apiKey")
		if (!apiKey) throw new Error("credential input not rendered")
		expect(apiKey.hasAttribute("required")).toBe(false)
		await type(apiKey, "sk-new")
		expect(apiKey.hasAttribute("required")).toBe(true)

		await act(async () => button(t("aiConfiguration.keepSavedCredentials")).click())
		await settle()

		expect(host.querySelector("#text-apiKey") === null).toBe(true)
		expect(savedCredentialSections()).toHaveLength(2)

		await act(async () => button(t("aiConfiguration.replaceCredentials")).click())
		await settle()
		const replaced = host.querySelector<HTMLInputElement>("#text-apiKey")
		if (!replaced) throw new Error("credential input not rendered after replacing again")
		await type(replaced, "sk-new")
		await submit()
		await settle()

		expect(host.querySelector("#text-apiKey") === null).toBe(true)
		expect(host.textContent).toContain(t("aiConfiguration.savedCredentials"))
	})

	test("restores each provider's draft when switching back", async () => {
		providers = [PROVIDER, OPENAI]
		await renderPage()
		await type(baseUrlInput(), "https://draft.example/v1")

		await choose("text-provider", t("aiConfiguration.providers.openai"))
		expect(triggerText("text-provider")).toContain(t("aiConfiguration.providers.openai"))
		expect(baseUrlInput().value).toBe("")
		await type(baseUrlInput(), "https://openai.example/v1")

		await choose("text-provider", t("aiConfiguration.providers.openaiCompatible"))
		expect(baseUrlInput().value).toBe("https://draft.example/v1")
	})

	test("shares the text connection with embeddings and saves the shared settings", async () => {
		providers = [PROVIDER, OPENAI]
		server = {
			revision: 1,
			health: "configured",
			text: roleConfiguration("openai-compatible", "chat-model", { baseURL: "https://server.example/v1" }),
			embedding: {
				...roleConfiguration("openai-compatible", "embedding-model", { baseURL: "https://server.example/v1" }),
				credentialSource: "text",
			},
		}
		await renderPage()
		expect(tab(t("aiConfiguration.tabs.sameProvider")).getAttribute("aria-selected")).toBe("true")

		await choose("text-provider", t("aiConfiguration.providers.openai"))
		expect(host.querySelector("#embedding-provider") === null).toBe(true)
		expect(host.querySelector<HTMLInputElement>("#embedding-model")?.value).toBe("embedding-model")

		await type(baseUrlInput(), "https://openai.example/v1/")
		await type(inputById("text-project"), "project-1")
		await type(inputById("text-apiKey"), "sk-openai")
		await type(inputById("text-model"), "chat-model")
		await submit()
		await settle()
		await act(async () => button(t("aiConfiguration.reembedConfirm"), confirmationDialog()).click())
		await settle()

		expect(saveRequests).toHaveLength(1)
		expect(saveRequests[0]?.text).toEqual({
			providerId: "openai",
			authMode: "static",
			modelId: "chat-model",
			settings: { baseURL: "https://openai.example/v1/", project: "project-1" },
			credentials: { apiKey: "sk-openai" },
		})
		expect(saveRequests[0]?.embedding).toEqual({
			providerId: "openai",
			authMode: "static",
			modelId: "embedding-model",
			settings: { baseURL: "https://openai.example/v1/", project: "project-1" },
			credentials: { apiKey: "sk-openai" },
			credentialSource: "text",
		})
	})

	test("falls back to an embedding provider when the text provider cannot embed", async () => {
		providers = [PROVIDER, BEDROCK]
		server = {
			revision: 1,
			health: "configured",
			text: roleConfiguration("openai-compatible", "chat-model", { baseURL: "https://server.example/v1" }),
			embedding: {
				...roleConfiguration("openai-compatible", "embedding-model", { baseURL: "https://server.example/v1" }),
				credentialSource: "text",
			},
		}
		await renderPage()

		await choose("text-provider", t("aiConfiguration.providers.amazonBedrock"))

		expect(tab(t("aiConfiguration.tabs.differentProvider")).getAttribute("aria-selected")).toBe("true")
		expect(tab(t("aiConfiguration.tabs.sameProvider")).getAttribute("aria-disabled")).toBe("true")
		expect(triggerText("embedding-provider")).toContain(t("aiConfiguration.providers.openaiCompatible"))
		expect(embeddingBaseUrlInput().value).toBe("")
		expect(host.querySelector<HTMLInputElement>("#embedding-model")?.value).toBe("embedding-model")
		expect(host.textContent).toContain(t("aiConfiguration.sameProviderUnavailable"))
		expect(inputById("text-region") === null).toBe(false)
		expect(inputById("text-accessKeyId") === null).toBe(false)
		expect(inputById("text-secretAccessKey") === null).toBe(false)
		expect(inputById("text-sessionToken") === null).toBe(false)
	})

	test("restores the stored embedding connection when choosing it again", async () => {
		providers = [PROVIDER, OPENAI]
		server = {
			revision: 1,
			health: "configured",
			text: roleConfiguration("openai-compatible", "chat-model", { baseURL: "https://server.example/v1" }),
			embedding: {
				...roleConfiguration("openai-compatible", "embedding-model", {
					baseURL: "https://embeddings.example/v1",
				}),
				credentialSource: "text",
			},
		}
		await renderPage()

		await choose("text-provider", t("aiConfiguration.providers.openai"))
		await act(async () => tab(t("aiConfiguration.tabs.differentProvider")).click())
		await settle()
		expect(inputById("embedding-apiKey") === null).toBe(false)

		await choose("embedding-provider", t("aiConfiguration.providers.openaiCompatible"))

		expect(embeddingBaseUrlInput().value).toBe("https://embeddings.example/v1")
		expect(host.querySelector("#embedding-apiKey") === null).toBe(true)
		expect(savedCredentialSections()).toHaveLength(1)
	})

	test("requires credentials after an unusable configuration and saves the replacement", async () => {
		server = {
			revision: 3,
			health: "unusable",
			text: roleConfiguration("openai-compatible", "chat-model", { baseURL: "https://server.example/v1" }, false),
			embedding: {
				...roleConfiguration("openai-compatible", "embedding-model", { baseURL: "https://server.example/v1" }, false),
				credentialSource: "text",
			},
		}
		await renderPage()

		expect(host.textContent).toContain(t("aiConfiguration.unusableWarning"))
		await submit()

		expect(host.querySelector("#text-apiKey-error")?.textContent).toBe(t("aiConfiguration.fields.fieldRequired"))
		expect(document.activeElement?.id).toBe("text-apiKey")
		expect(saveRequests).toHaveLength(0)

		await type(inputById("text-apiKey"), "sk-restored")
		await submit()
		await settle()

		expect(saveRequests).toHaveLength(1)
		expect(saveRequests[0]?.text).toMatchObject({ authMode: "static", credentials: { apiKey: "sk-restored" } })
		expect(host.textContent).toContain(t("aiConfiguration.saved"))
	})

	test("keeps the draft and reports a failed save until the retry succeeds", async () => {
		await renderPage()
		const edited = "https://retry.example/v1"
		await type(baseUrlInput(), edited)

		const firstSave = Promise.withResolvers<Response>()
		saveResponse = firstSave.promise
		await submit()
		await settle()

		expect(button(t("aiConfiguration.saving")).disabled).toBe(true)
		await act(async () => {
			firstSave.resolve(
				json({ code: "provider-unreachable", type: "https://docs.talqo.chat/problems#provider-unreachable" }, 502),
			)
			await Promise.resolve()
		})
		await settle()

		expect(host.querySelector("form [role=alert]")?.textContent).toBe(t("problems.provider-unreachable"))
		expect(baseUrlInput().value).toBe(edited)
		expect(saveRequests).toHaveLength(1)

		await submit()
		await settle()

		expect(saveRequests).toHaveLength(2)
		expect(host.textContent).toContain(t("aiConfiguration.saved"))
	})

	test("shows the load error page and retries both queries", async () => {
		providersFailure = json({}, 500)
		await renderPage()

		expect(host.textContent).toContain(t("aiConfiguration.loadError"))
		const configurationRequestsBeforeRetry = configurationRequests
		providersFailure = undefined
		await act(async () => button(t("common.retry")).click())
		await settle()
		await settle()

		expect(configurationRequests).toBeGreaterThan(configurationRequestsBeforeRetry)
		expect(baseUrlInput().value).toBe("https://server.example/v1")
	})

	test("hides credentials and saves deployment identity without them", async () => {
		providers = [OPENAI]
		server = {
			revision: 1,
			health: "configured",
			text: roleConfiguration("openai", "chat-model", { baseURL: "https://server.example/v1" }),
			embedding: {
				...roleConfiguration("openai", "embedding-model", { baseURL: "https://server.example/v1" }),
				credentialSource: "text",
			},
		}
		await renderPage()

		await choose("text-authentication", t("aiConfiguration.auth.deploymentIdentity"))
		expect(host.querySelector("#text-apiKey") === null).toBe(true)
		expect(savedCredentialSections()).toHaveLength(0)

		await submit()
		await settle()

		expect(saveRequests).toHaveLength(1)
		expect(saveRequests[0]?.text).toEqual({
			providerId: "openai",
			authMode: "deployment-identity",
			modelId: "chat-model",
			settings: { baseURL: "https://server.example/v1" },
		})
		expect(saveRequests[0]?.embedding).toMatchObject({ authMode: "deployment-identity", credentialSource: "text" })
	})

	test("closes the re-embed confirmation through the dialog close button", async () => {
		await renderPage()
		await type(embeddingBaseUrlInput(), "https://closed.example/v1")
		await submit()
		await settle()
		expect(confirmationDialog().textContent).toContain(t("aiConfiguration.reembedTitle"))

		await act(async () => button(t("common.close"), confirmationDialog()).click())
		await settle()

		expect(document.querySelector("[role=dialog]") === null).toBe(true)
		expect(saveRequests).toHaveLength(0)
		expect(embeddingBaseUrlInput().value).toBe("https://closed.example/v1")
	})

	test("associates a missing embedding setting with its field and focuses it", async () => {
		await renderPage()
		const baseUrl = embeddingBaseUrlInput()
		await type(baseUrl, "")
		await submit()
		await settle()

		expect(host.querySelector("#embedding-baseURL-error")?.textContent).toBe(t("aiConfiguration.fields.fieldRequired"))
		expect(baseUrl.getAttribute("aria-invalid")).toBe("true")
		expect(baseUrl.getAttribute("aria-describedby")).toBe("embedding-baseURL-error")
		expect(document.activeElement?.id).toBe("embedding-baseURL")
	})

	test("ignores settings key order when deciding whether embeddings changed", async () => {
		providers = [OPENAI]
		server = {
			revision: 1,
			health: "configured",
			text: roleConfiguration("openai", "chat-model", {
				baseURL: "https://server.example/v1",
				project: "project-1",
			}),
			embedding: {
				...roleConfiguration("openai", "embedding-model", {
					project: "project-1",
					baseURL: "https://server.example/v1",
				}),
				credentialSource: "text",
			},
		}
		await renderPage()

		await type(inputById("text-model"), "chat-model-next")
		await submit()
		await settle()

		expect(document.querySelector("[role=dialog]") === null).toBe(true)
		expect(saveRequests).toHaveLength(1)
		expect(saveRequests[0]?.embedding.settings).toEqual({
			baseURL: "https://server.example/v1",
			project: "project-1",
		})
	})

	test("associates a missing embedding model with its field and focuses it", async () => {
		await renderPage()
		const model = host.querySelector<HTMLInputElement>("#embedding-model")
		if (!model) throw new Error("embedding model input not rendered")

		await type(model, "")
		await submit()
		await settle()

		const error = host.querySelector<HTMLElement>("#embedding-model-error")
		expect(error?.textContent).toBe(t("aiConfiguration.fields.modelRequired"))
		expect(model.getAttribute("aria-invalid")).toBe("true")
		expect(model.getAttribute("aria-describedby")).toBe("embedding-model-error")
		expect(document.activeElement === model).toBe(true)
	})
})
