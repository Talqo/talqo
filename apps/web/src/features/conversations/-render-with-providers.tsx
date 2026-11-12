import type { QueryClient } from "@tanstack/react-query"
import type { Root } from "react-dom/client"

import { LanguageProvider } from "@/lib/use-language"
import { act, QueryClientProvider } from "@/testing/component-harness"
import { RouterProvider } from "@tanstack/react-router"

type Router = Parameters<typeof RouterProvider>[0]["router"]

export async function renderConversationsPage(root: Root, queryClient: QueryClient, router: Router): Promise<void> {
	await act(async () =>
		root.render(
			<QueryClientProvider client={queryClient}>
				<LanguageProvider>
					<RouterProvider router={router} />
				</LanguageProvider>
			</QueryClientProvider>,
		),
	)
}
