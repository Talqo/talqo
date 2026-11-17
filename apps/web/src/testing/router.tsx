import type { AnyRouter } from "@tanstack/react-router"
import type { Root } from "react-dom/client"

import type { QueryClient } from "./component-harness"

const { LanguageProvider } = await import("@/lib/use-language")
const { QueryClientProvider } = await import("@tanstack/react-query")
const { RouterProvider } = await import("@tanstack/react-router")
const { act, settle } = await import("./component-harness")

export async function renderRouter(root: Root, queryClient: InstanceType<typeof QueryClient>, router: AnyRouter) {
	await act(async () => {
		await router.load()
		root.render(
			<QueryClientProvider client={queryClient}>
				<LanguageProvider>
					<RouterProvider router={router} />
				</LanguageProvider>
			</QueryClientProvider>,
		)
	})
	await settle()
	await settle()
}
