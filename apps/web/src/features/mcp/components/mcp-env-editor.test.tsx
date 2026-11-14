import type { EnvVariable } from "@/features/mcp/mcp-env-variables"
import type { Root } from "react-dom/client"

import { click, findButton as button, typeInto as type } from "@/testing/dom"
import { GlobalRegistrator } from "@happy-dom/global-registrator"
import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register({ url: "http://localhost/" })
await import("@/lib/i18n")
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const { McpEnvEditor } = await import("./mcp-env-editor")
const { MCP_ENV_VARIABLE_LIMIT } = await import("@/features/mcp/mcp-env-variables")
const { createRoot } = await import("react-dom/client")
const { act, useState } = await import("react")
const { t } = await import("i18next")

let host: HTMLDivElement
let root: Root
let emitted: EnvVariable[][]

function ControlledEditor({
	initialEnv,
	kind,
	invalidRowId,
	errorId,
}: {
	initialEnv: EnvVariable[]
	kind?: "env" | "headers"
	invalidRowId?: string
	errorId?: string
}) {
	const [env, setEnv] = useState(initialEnv)
	return (
		<McpEnvEditor
			env={env}
			kind={kind}
			invalidRowId={invalidRowId}
			errorId={errorId}
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

async function renderEditor(
	env: EnvVariable[],
	options: { kind?: "env" | "headers"; invalidRowId?: string; errorId?: string } = {},
) {
	emitted = []
	await act(async () =>
		root.render(
			<ControlledEditor
				key={`${options.kind ?? "env"}-${env.map(({ id }) => id).join("|")}-${options.invalidRowId ?? ""}`}
				initialEnv={env}
				{...options}
			/>,
		),
	)
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

beforeEach(() => {
	host = document.createElement("div")
	document.body.append(host)
	root = createRoot(host)
})

afterEach(async () => {
	await act(async () => root.unmount())
	host.remove()
	mock.restore()
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

	test("labels environment rows, adds one, and reports the environment count", async () => {
		spyOn(globalThis.crypto, "randomUUID").mockReturnValue("123e4567-e89b-42d3-a456-426614174001")
		await renderEditor([{ id: "first", name: "API_URL", value: "https://example.test" }])

		expect(host.textContent).toContain(t("mcp.envVariables"))
		expect(host.textContent).toContain(t("mcp.envCount", { used: 1, limit: MCP_ENV_VARIABLE_LIMIT }))
		await click(button(t("mcp.addEnv")))

		expect(emitted).toEqual([
			[
				{ id: "first", name: "API_URL", value: "https://example.test" },
				{ id: "123e4567-e89b-42d3-a456-426614174001", name: "", value: "" },
			],
		])
	})

	test("labels header rows, adds a header, and removes only the selected header", async () => {
		spyOn(globalThis.crypto, "randomUUID").mockReturnValue("123e4567-e89b-42d3-a456-426614174002")
		await renderEditor(
			[
				{ id: "first", name: "X-API-Key", value: "secret" },
				{ id: "second", name: "X-Request-ID", value: "" },
			],
			{ kind: "headers" },
		)

		expect(inputValues(t("mcp.headerName"))).toEqual(["X-API-Key", "X-Request-ID"])
		expect(inputs(t("mcp.envName"))).toHaveLength(0)
		expect(host.textContent).toContain(t("mcp.headers"))
		expect(input(0, t("mcp.headerName")).id).toBe("mcp-headers-first-name")
		expect(input(0, t("mcp.headerValue")).id).toBe("mcp-headers-first-value")
		expect(host.textContent).toContain(t("mcp.headersCount", { used: 2, limit: MCP_ENV_VARIABLE_LIMIT }))

		await click(button(t("mcp.addHeader")))
		expect(emitted.at(-1)).toEqual([
			{ id: "first", name: "X-API-Key", value: "secret" },
			{ id: "second", name: "X-Request-ID", value: "" },
			{ id: "123e4567-e89b-42d3-a456-426614174002", name: "", value: "" },
		])

		await click(button(t("mcp.removeHeader", { name: "X-API-Key" })))
		expect(emitted.at(-1)).toEqual([
			{ id: "second", name: "X-Request-ID", value: "" },
			{ id: "123e4567-e89b-42d3-a456-426614174002", name: "", value: "" },
		])
	})

	test("links the field error only to the invalid row", async () => {
		await renderEditor(envRows(), { invalidRowId: "second", errorId: "mcp-env-error" })

		expect(input(0, t("mcp.envName")).getAttribute("aria-invalid")).toBe("false")
		expect(input(1, t("mcp.envName")).getAttribute("aria-invalid")).toBe("true")
		expect(input(1, t("mcp.envName")).getAttribute("aria-describedby")).toBe("mcp-env-error")
		expect(input(1, t("mcp.envValue")).getAttribute("aria-invalid")).toBe("true")
		expect(input(1, t("mcp.envValue")).getAttribute("aria-describedby")).toBe("mcp-env-error")
		expect(input(2, t("mcp.envValue")).getAttribute("aria-invalid")).toBe("false")
		expect(input(2, t("mcp.envValue")).getAttribute("aria-describedby")).toBeNull()
	})

	test("prevents adding another variable at the limit", async () => {
		await renderEditor(
			Array.from({ length: MCP_ENV_VARIABLE_LIMIT }, (_, index) => ({
				id: `id-${index}`,
				name: `NAME_${index}`,
				value: "",
			})),
		)

		const add = button(t("mcp.addEnv"))
		expect(add.disabled).toBe(true)
		await click(add)
		expect(emitted).toEqual([])
	})

	test("names an unnamed row by its one-based position in the remove label", async () => {
		await renderEditor([
			{ id: "first", name: "API_URL", value: "" },
			{ id: "second", name: "   ", value: "orphan" },
		])

		const remove = button(t("mcp.removeEnv", { name: 2 }))
		await click(remove)

		expect(emitted).toEqual([[{ id: "first", name: "API_URL", value: "" }]])
	})
})
