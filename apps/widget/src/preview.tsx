import { createRoot } from "react-dom/client"

import { EmbeddedWidget } from "./embedded-widget"
import { isWidgetLanguage } from "./lib/i18n"

// Standalone preview page: the dashboard previews the widget by embedding this
// page in an iframe instead of importing widget code. Config arrives as URL
// params, e.g. /preview.html?accent=%231a7f4b&language=cs&theme=dark.
const params = new URLSearchParams(window.location.search)
const language = params.get("language")
const theme = params.get("theme")

const rootElement = document.querySelector("#talqo-widget")

if (!(rootElement instanceof HTMLElement)) {
	throw new Error("Root element not found")
}

createRoot(rootElement).render(
	<EmbeddedWidget
		title={params.get("title") ?? undefined}
		language={isWidgetLanguage(language) ? language : undefined}
		theme={theme === "light" || theme === "dark" ? theme : undefined}
		accent={params.get("accent") ?? undefined}
	/>,
)
