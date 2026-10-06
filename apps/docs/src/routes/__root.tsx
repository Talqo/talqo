import type { ReactNode } from "react"

import { createRootRoute, HeadContent, Link, Outlet, Scripts } from "@tanstack/react-router"
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
	notFoundComponent: NotFound,
})

function NotFound() {
	return (
		<main className="mx-auto max-w-3xl px-6 py-12">
			<h1 className="text-3xl font-semibold">Page not found</h1>
			<p className="text-fd-muted-foreground mt-3">
				That address does not exist. Start from the{" "}
				<Link to="/$" params={{ _splat: "" }}>
					documentation index
				</Link>
				.
			</p>
		</main>
	)
}

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
