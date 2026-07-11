import { createFileRoute, Outlet } from "@tanstack/react-router"
import { createServerFn } from "@tanstack/react-start"
import { deserializePageTree } from "fumadocs-core/source/client"
import { DocsLayout } from "fumadocs-ui/layouts/docs"

const getPageTree = createServerFn().handler(async () => {
	const { source } = await import("@/lib/source")

	return source.serializePageTree(source.pageTree)
})

export const Route = createFileRoute("/docs")({
	loader: () => getPageTree(),
	component: Layout,
})

function Layout() {
	const pageTree = deserializePageTree(Route.useLoaderData())

	return (
		<DocsLayout tree={pageTree} nav={{ title: "Talqo" }}>
			<Outlet />
		</DocsLayout>
	)
}
