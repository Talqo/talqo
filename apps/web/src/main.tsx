import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { createRouter, RouterProvider } from "@tanstack/react-router"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import { LanguageProvider } from "./lib/use-language"
import { applyTheme, getInitialTheme, ThemeProvider } from "./lib/use-theme"
import { routeTree } from "./routeTree.gen"

import "@talqo/ui/globals.css"
// eslint-disable-next-line import/no-unassigned-import -- initializes the dashboard i18next instance for side effects.
import "./lib/i18n"

// Apply the persisted/system theme before first paint to avoid a flash of the wrong theme.
applyTheme(getInitialTheme())

const queryClient = new QueryClient()

const router = createRouter({ routeTree })

declare module "@tanstack/react-router" {
	// eslint-disable-next-line typescript/consistent-type-definitions -- TanStack Router requires interface merging.
	interface Register {
		router: typeof router
	}
}

const root = document.querySelector("#root")

if (!root) {
	throw new Error("Root element not found")
}

createRoot(root).render(
	<StrictMode>
		<ThemeProvider>
			<LanguageProvider>
				<QueryClientProvider client={queryClient}>
					<RouterProvider router={router} />
				</QueryClientProvider>
			</LanguageProvider>
		</ThemeProvider>
	</StrictMode>,
)
