import { act } from "./component-harness"
import { typeInto } from "./dom"

export function field(id: string): HTMLInputElement {
	const element = document.getElementById(id)
	if (!(element instanceof HTMLInputElement)) throw new Error(`${id} input not rendered`)
	return element
}

export async function typeField(id: string, text: string): Promise<void> {
	await typeInto(field(id), text)
}

export async function submitForm(scope: ParentNode = document): Promise<void> {
	await act(async () =>
		scope.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
	)
}
