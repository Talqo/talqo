import type { ArgumentRow } from "@/features/mcp/mcp-arguments"
import type { Root } from "react-dom/client"

import { act, createTestHarness } from "@/testing/component-harness"
import { click, findButton as button, typeInto as type } from "@/testing/dom"
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"

const { McpArgumentsEditor } = await import("./mcp-arguments-editor")
const { MCP_ARGUMENT_LIMIT } = await import("@/features/mcp/mcp-arguments")
const { useState } = await import("react")
const { t } = await import("i18next")

let host: HTMLDivElement
let root: Root
let harness: ReturnType<typeof createTestHarness>
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

beforeEach(() => {
	harness = createTestHarness()
	;({ host, root } = harness)
})

afterEach(async () => {
	await harness.dispose()
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
