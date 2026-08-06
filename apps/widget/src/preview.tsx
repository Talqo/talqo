import { createRoot } from "react-dom/client"

import { EmbeddedWidget } from "./embedded-widget"
import { isWidgetLanguage } from "./lib/i18n"

// Dashboard iframe preview of the widget; config arrives as URL params
// (title, language, theme, accent, position).
const params = new URLSearchParams(window.location.search)
const language = params.get("language")
const theme = params.get("theme")
const position = params.get("position")

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
		position={position === "bottom-left" || position === "bottom-right" ? position : undefined}
	/>,
)
