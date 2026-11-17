import { act, settle } from "./component-harness"

export function findButton(label: string, scope: ParentNode = document): HTMLButtonElement {
	const found = [...scope.querySelectorAll("button")].find(
		(candidate) => candidate.textContent?.trim() === label || candidate.getAttribute("aria-label") === label,
	)
	if (!found) throw new Error(`button ${label} not rendered`)
	return found
}

export async function click(target: HTMLElement): Promise<void> {
	await act(async () => target.click())
	await settle()
	await settle()
}

export async function typeInto(input: HTMLInputElement | HTMLTextAreaElement, value: string): Promise<void> {
	const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
	await act(async () => {
		Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(input, value)
		input.dispatchEvent(new Event("input", { bubbles: true }))
	})
}
