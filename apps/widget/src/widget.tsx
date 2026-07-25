import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

export function mountWidget(element: Element): void {
	createRoot(element).render(
		<StrictMode>
			<h1>Talqo Widget</h1>
		</StrictMode>,
	)
}
