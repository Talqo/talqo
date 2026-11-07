import type { EnvVariable } from "@/features/mcp/mcp-env-variables"
import type { Root } from "react-dom/client"

import { GlobalRegistrator } from "@happy-dom/global-registrator"
import { afterEach, beforeEach, describe, expect, test } from "bun:test"

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register({ url: "http://localhost/" })
await import("@/lib/i18n")
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const { McpEnvEditor } = await import("./mcp-env-editor")
const { createRoot } = await import("react-dom/client")
const { act, useState } = await import("react")
const { t } = await import("i18next")

let host: HTMLDivElement
let root: Root
let emitted: EnvVariable[][]

function ControlledEditor({ initialEnv }: { initialEnv: EnvVariable[] }) {
	const [env, setEnv] = useState(initialEnv)
	return (
		<McpEnvEditor
			env={env}
			onChange={(nextEnv) => {
				emitted.push(nextEnv)
				setEnv(nextEnv)
			}}
		/>
	)
}

function envRows(): EnvVariable[] {
	return [
		{ id: "first", name: "API_URL", value: "https://example.test" },
		{ id: "second", name: "API_KEY", value: "old-secret" },
		{ id: "third", name: "LOG_LEVEL", value: "info" },
	]
}

async function renderEditor(env: EnvVariable[]) {
	emitted = []
	await act(async () => root.render(<ControlledEditor initialEnv={env} />))
}

function inputs(label: string): HTMLInputElement[] {
	return [...host.querySelectorAll<HTMLInputElement>(`input[aria-label="${label}"]`)]
}

function input(index: number, label: string): HTMLInputElement {
	const found = inputs(label)[index]
	if (!found) throw new Error(`Missing ${label} input ${index}`)
	return found
}

function inputValues(label: string): string[] {
	return inputs(label).map((field) => field.value)
}

function button(label: string): HTMLButtonElement {
	const found = [...host.querySelectorAll("button")].find(
		(candidate) => candidate.textContent?.trim() === label || candidate.getAttribute("aria-label") === label,
	)
	if (!found) throw new Error(`Missing button ${label}`)
	return found
}

async function click(target: HTMLElement) {
	await act(async () => target.click())
}

async function type(target: HTMLInputElement, value: string) {
	await act(async () => {
		const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
		valueSetter?.call(target, value)
		target.dispatchEvent(new Event("input", { bubbles: true }))
	})
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

describe("McpEnvEditor", () => {
	test("updates only the selected variable's name and value while preserving row IDs and order", async () => {
		await renderEditor(envRows())

		await type(input(1, t("mcp.envName")), "AUTH_TOKEN")
		await type(input(1, t("mcp.envValue")), "new-secret")

		expect(emitted).toEqual([
			[
				{ id: "first", name: "API_URL", value: "https://example.test" },
				{ id: "second", name: "AUTH_TOKEN", value: "old-secret" },
				{ id: "third", name: "LOG_LEVEL", value: "info" },
			],
			[
				{ id: "first", name: "API_URL", value: "https://example.test" },
				{ id: "second", name: "AUTH_TOKEN", value: "new-secret" },
				{ id: "third", name: "LOG_LEVEL", value: "info" },
			],
		])
		expect(inputValues(t("mcp.envName"))).toEqual(["API_URL", "AUTH_TOKEN", "LOG_LEVEL"])
		expect(inputValues(t("mcp.envValue"))).toEqual(["https://example.test", "new-secret", "info"])
	})

	test("removes only the selected variable", async () => {
		await renderEditor(envRows())

		await click(button(t("mcp.removeEnv", { name: "API_KEY" })))

		expect(emitted).toEqual([
			[
				{ id: "first", name: "API_URL", value: "https://example.test" },
				{ id: "third", name: "LOG_LEVEL", value: "info" },
			],
		])
		expect(inputValues(t("mcp.envName"))).toEqual(["API_URL", "LOG_LEVEL"])
		expect(inputValues(t("mcp.envValue"))).toEqual(["https://example.test", "info"])
	})
})
