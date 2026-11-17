import type { ChatClient } from "@talqo/sdk"
import type { WidgetAppearance } from "@talqo/shared/widget-appearance"

export type ChatBoot =
	| { mode: "connected"; client: ChatClient; appearance: WidgetAppearance; title?: string }
	| { mode: "preview"; parentOrigin?: string }

export type ChatModule = {
	mount(target: HTMLElement, boot: ChatBoot): void
	unmount(): void
}

type WidgetGlobals = {
	TalqoWidgetChat?: ChatModule
	/** Vite dev loads the chat entry directly instead of injecting the built file. */
	talqoDevChat?: ChatModule
}

export function widgetGlobals(): WidgetGlobals {
	return window as WidgetGlobals
}
