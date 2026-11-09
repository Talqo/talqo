import type { ArgumentRow } from "@/features/mcp/mcp-arguments"
import type { Root } from "react-dom/client"

import { GlobalRegistrator } from "@happy-dom/global-registrator"
import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register({ url: "http://localhost/" })
await import("@/lib/i18n")
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const { McpArgumentsEditor } = await import("./mcp-arguments-editor")
const { MCP_ARGUMENT_LIMIT } = await import("@/features/mcp/mcp-arguments")
const { createRoot } = await import("react-dom/client")
const { act, useState } = await import("react")
const { t } = await import("i18next")

let host: HTMLDivElement
let root: Root
let emitted: ArgumentRow[][]

function ControlledEditor({ initialArgs }: { initialArgs: ArgumentRow[] }) {
	const [args, setArgs] = useState(initialArgs)
	return (
		<McpArgumentsEditor
			args={args}
			onChange={(nextArgs) => {
				emitted.push(nextArgs)
				setArgs(nextArgs)
			}}
		/>
	)
}

async function renderEditor(initialArgs: ArgumentRow[]) {
	emitted = []
	await act(async () => root.render(<ControlledEditor initialArgs={initialArgs} />))
}

function argumentInput(index: number): HTMLInputElement {
	const input = host.querySelectorAll<HTMLInputElement>("input")[index]
	if (!input) throw new Error(`Missing argument input ${index}`)
	return input
}

function argumentValues(): string[] {
	return [...host.querySelectorAll<HTMLInputElement>("input")].map((input) => input.value)
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

async function type(input: HTMLInputElement, value: string) {
	await act(async () => {
		const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
		valueSetter?.call(input, value)
		input.dispatchEvent(new Event("input", { bubbles: true }))
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
	mock.restore()
})

describe("McpArgumentsEditor", () => {
	test("appends a blank argument without changing existing rows", async () => {
		spyOn(globalThis.crypto, "randomUUID").mockReturnValue("123e4567-e89b-42d3-a456-426614174000")
		await renderEditor([
			{ id: "first", value: "--verbose" },
			{ id: "second", value: "--format=json" },
		])

		await click(button(t("mcp.addArgument")))

		expect(emitted).toEqual([
			[
				{ id: "first", value: "--verbose" },
				{ id: "second", value: "--format=json" },
				{ id: "123e4567-e89b-42d3-a456-426614174000", value: "" },
			],
		])
		expect(argumentValues()).toEqual(["--verbose", "--format=json", ""])
	})

	test("updates only the edited argument and preserves row order", async () => {
		await renderEditor([
			{ id: "first", value: "--verbose" },
			{ id: "second", value: "--format=json" },
			{ id: "third", value: "--timeout=30" },
		])

		await type(argumentInput(1), "--format=yaml")

		expect(emitted).toEqual([
			[
				{ id: "first", value: "--verbose" },
				{ id: "second", value: "--format=yaml" },
				{ id: "third", value: "--timeout=30" },
			],
		])
		expect(argumentValues()).toEqual(["--verbose", "--format=yaml", "--timeout=30"])
	})

	test("removes only the selected argument", async () => {
		await renderEditor([
			{ id: "first", value: "--verbose" },
			{ id: "second", value: "--format=json" },
			{ id: "third", value: "--timeout=30" },
		])

		await click(button(t("mcp.removeArgument", { argument: "--format=json" })))

		expect(emitted).toEqual([
			[
				{ id: "first", value: "--verbose" },
				{ id: "third", value: "--timeout=30" },
			],
		])
		expect(argumentValues()).toEqual(["--verbose", "--timeout=30"])
	})

	test("prevents adding another argument at the limit", async () => {
		await renderEditor(
			Array.from({ length: MCP_ARGUMENT_LIMIT }, (_, index) => ({ id: `id-${index}`, value: `value-${index}` })),
		)

		const add = button(t("mcp.addArgument"))
		expect(add.disabled).toBe(true)
		await click(add)
		expect(emitted).toEqual([])
	})

	test("names an empty argument by its one-based position in the remove label", async () => {
		await renderEditor([
			{ id: "first", value: "--verbose" },
			{ id: "second", value: "   " },
		])

		await click(button(t("mcp.removeArgument", { argument: 2 })))

		expect(emitted).toEqual([[{ id: "first", value: "--verbose" }]])
	})
})
