import type { ReactNode } from "react"

import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router"
import { RootProvider } from "fumadocs-ui/provider/tanstack"

import "@/styles/app.css"

export const Route = createRootRoute({
	head: () => ({
		meta: [
			{ charSet: "utf-8" },
			{ name: "viewport", content: "width=device-width, initial-scale=1" },
			{ title: "Talqo Docs" },
		],
	}),
	component: Root,
})

function Root() {
	return (
		<Document>
			<Outlet />
		</Document>
	)
}

function Document({ children }: Readonly<{ children: ReactNode }>) {
	return (
		<html lang="en" suppressHydrationWarning>
			<head>
				<HeadContent />
			</head>
			<body>
				<RootProvider>{children}</RootProvider>
				<Scripts />
			</body>
		</html>
	)
}
