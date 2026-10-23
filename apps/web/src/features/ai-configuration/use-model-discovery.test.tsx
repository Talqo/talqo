import type { Root } from "react-dom/client"

import { GlobalRegistrator } from "@happy-dom/global-registrator"
import { afterEach, beforeEach, describe, expect, jest, mock, spyOn, test } from "bun:test"

import type { DiscoveryContext } from "./discovery-readiness.ts"

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register({ url: "http://localhost/" })
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const { useModelDiscovery } = await import("./use-model-discovery")
const { createRoot } = await import("react-dom/client")
const { act } = await import("react")
const { Controller, useForm } = await import("react-hook-form")

type Context = DiscoveryContext & { storedCredentialRole: "text" | "embedding" }

const CONTEXT: Context = {
	provider: {
		id: "openai-compatible",
		roles: ["text", "embedding"],
		authModes: ["static"],
		settingFields: ["baseURL"],
		requiredSettingFields: ["baseURL"],
		credentialFields: ["apiKey"],
		requiredCredentialFields: ["apiKey"],
		discovery: true,
	},
	value: {
		authMode: "static",
		settings: { baseURL: "https://models.example/v1" },
		credentials: { apiKey: "test-key" },
	},
	stored: null,
	storedCredentialRole: "text",
}

type Request = ReturnType<typeof Promise.withResolvers<Response>> & { signal: AbortSignal | null | undefined }

let requests: Request[]
let host: HTMLDivElement
let root: Root

function Discovery({ context }: { context: Context }) {
	const { models, loading, failed, retry } = useModelDiscovery(context)
	return (
		<>
			<output>{loading ? "loading" : failed ? "failed" : (models?.join(",") ?? "unavailable")}</output>
			<button type="button" onClick={retry}>
				Retry
			</button>
		</>
	)
}

function status(): string | null | undefined {
	return host.querySelector("output")?.textContent
}

function ModelForm() {
	const { control } = useForm<{ role: Context["value"] & { modelId: string } }>({
		defaultValues: { role: { ...CONTEXT.value, modelId: "initial-model" } },
	})
	return (
		<Controller
			control={control}
			name="role"
			render={({ field }) => (
				<>
					<Discovery context={{ ...CONTEXT, value: field.value }} />
					<input aria-label="Model ID" value={field.value.modelId} readOnly />
					<button
						type="button"
						data-model-change
						onClick={() => field.onChange({ ...field.value, modelId: "changed-model" })}
					>
						Change model
					</button>
				</>
			)}
		/>
	)
}

async function render(context: Context): Promise<void> {
	await act(async () => root.render(<Discovery context={context} />))
}

async function advance(milliseconds: number): Promise<void> {
	await act(async () => jest.advanceTimersByTime(milliseconds))
}

async function answer(request: Request | undefined, models: string[]): Promise<void> {
	if (!request) throw new Error("Discovery request missing")
	await act(async () => request.resolve(new Response(JSON.stringify({ models }), { status: 200 })))
}

beforeEach(() => {
	jest.useFakeTimers()
	requests = []
	const fetchDiscovery = Object.assign(
		(_input: RequestInfo | URL, init?: RequestInit) => {
			const request = { ...Promise.withResolvers<Response>(), signal: init?.signal }
			requests.push(request)
			return request.promise
		},
		{ preconnect: fetch.preconnect },
	)
	spyOn(globalThis, "fetch").mockImplementation(fetchDiscovery)
	host = document.createElement("div")
	document.body.append(host)
	root = createRoot(host)
})

afterEach(async () => {
	await act(async () => root.unmount())
	host.remove()
	jest.useRealTimers()
	mock.restore()
})

describe("model discovery", () => {
	test("model-only form edits preserve discovered models without another request", async () => {
		await act(async () => root.render(<ModelForm />))
		await advance(400)
		await answer(requests[0], ["discovered-model"])
		expect(status()).toBe("discovered-model")
		await act(async () => host.querySelector<HTMLButtonElement>("[data-model-change]")?.click())
		expect(host.querySelector<HTMLInputElement>("input")?.value).toBe("changed-model")
		expect(status()).toBe("discovered-model")
		await advance(400)
		expect(requests).toHaveLength(1)
	})
	test("debounces connection edits and shows the latest models", async () => {
		await render(CONTEXT)
		expect(status()).toBe("loading")
		await advance(399)
		expect(requests).toHaveLength(0)
		await render({ ...CONTEXT, value: { ...CONTEXT.value, settings: { baseURL: "https://other.example/v1" } } })
		await advance(399)
		expect(requests).toHaveLength(0)
		await advance(1)
		expect(requests).toHaveLength(1)
		await answer(requests[0], ["chat-model"])
		expect(status()).toBe("chat-model")
	})

	test("an obsolete response cannot replace a newer result", async () => {
		await render(CONTEXT)
		await advance(400)
		await render({ ...CONTEXT, value: { ...CONTEXT.value, settings: { baseURL: "https://other.example/v1" } } })
		await advance(400)
		await answer(requests[1], ["new-model"])
		await answer(requests[0], ["old-model"])
		expect(status()).toBe("new-model")
		expect(requests[0]?.signal?.aborted).toBe(true)
	})

	test("invalid credentials clear models and ignore an in-flight response", async () => {
		await render(CONTEXT)
		await advance(400)
		await render({ ...CONTEXT, value: { ...CONTEXT.value, credentials: {} } })
		expect(status()).toBe("unavailable")
		await answer(requests[0], ["old-model"])
		expect(status()).toBe("unavailable")
		await advance(400)
		expect(requests).toHaveLength(1)
	})

	test("a failed discovery can be retried without changing the connection", async () => {
		await render(CONTEXT)
		await advance(400)
		await act(async () => requests[0]?.reject(new Error("Provider unavailable")))
		expect(status()).toBe("failed")
		await act(async () => host.querySelector("button")?.click())
		expect(status()).toBe("loading")
		await advance(400)
		await answer(requests[1], ["recovered-model"])
		expect(status()).toBe("recovered-model")
	})
})
