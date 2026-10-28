import { getListAgentsQueryKey } from "@/api/generated/agent/agent"
import { getGetMyPermissionsQueryKey } from "@/api/generated/roles/roles"
import { QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { createRouter, RouterProvider } from "@tanstack/react-router"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import { PendingPage } from "./components/page-skeleton"
import { LanguageProvider } from "./lib/use-language"
import { applyTheme, getInitialTheme, ThemeProvider } from "./lib/use-theme"
import { routeTree } from "./routeTree.gen"

import "@talqo/ui/globals.css"
// eslint-disable-next-line import/no-unassigned-import
import "./lib/i18n"

applyTheme(getInitialTheme())

const FORBIDDEN_STATUS = 403
const NOT_FOUND_STATUS = 404
const queryClient = new QueryClient({
	queryCache: new QueryCache({
		onError(error, query) {
			if (!("status" in error) || (error.status !== FORBIDDEN_STATUS && error.status !== NOT_FOUND_STATUS)) return
			query.setState({ data: undefined })
			if (query.queryKey[0] !== getListAgentsQueryKey()[0])
				void queryClient.invalidateQueries({ queryKey: getListAgentsQueryKey() })
			if (query.queryKey[0] !== getGetMyPermissionsQueryKey()[0])
				void queryClient.invalidateQueries({ queryKey: getGetMyPermissionsQueryKey() })
		},
	}),
})

const router = createRouter({
	routeTree,
	scrollRestoration: true,
	defaultPendingComponent: PendingPage,
	// Show the skeleton only for route work slow enough to notice; fast navigations render directly.
	defaultPendingMs: 150,
})

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
