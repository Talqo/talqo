import { createRoot, type Root } from "react-dom/client"

import { ConnectedEmbeddedWidget } from "./embedded-widget"
import { type ChatBoot, type ChatModule, widgetGlobals } from "./lib/chat-bridge"
import { PreviewWidget } from "./preview"

let root: Root | null = null

export function mount(target: HTMLElement, boot: ChatBoot) {
	unmount()
	target.replaceChildren()
	root = createRoot(target)

	if (boot.mode === "preview") {
		root.render(<PreviewWidget parentOrigin={boot.parentOrigin} />)
		return
	}

	root.render(
		<ConnectedEmbeddedWidget
			client={boot.client}
			title={boot.title}
			appearance={boot.appearance}
			defaultOpen
			disposeOnUnmount={false}
		/>,
	)
}

export function unmount() {
	if (root) {
		root.unmount()
		root = null
	}
}

const chatModule: ChatModule = { mount, unmount }
widgetGlobals().TalqoWidgetChat = chatModule
