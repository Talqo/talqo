import { createRouter, RouterProvider } from "@tanstack/react-router"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import { routeTree } from "./routeTree.gen"

import "@talqo/ui/globals.css"

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
		<RouterProvider router={router} />
	</StrictMode>,
)
