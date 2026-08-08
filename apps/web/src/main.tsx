import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { createRouter, RouterProvider } from "@tanstack/react-router"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import { LanguageProvider } from "./lib/use-language"
import { applyTheme, getInitialTheme, ThemeProvider } from "./lib/use-theme"
import { routeTree } from "./routeTree.gen"

import "@talqo/ui/globals.css"
// eslint-disable-next-line import/no-unassigned-import
import "./lib/i18n"

applyTheme(getInitialTheme())

const queryClient = new QueryClient()

const router = createRouter({ routeTree })

declare module "@tanstack/react-router" {
	// eslint-disable-next-line typescript/consistent-type-definitions
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
