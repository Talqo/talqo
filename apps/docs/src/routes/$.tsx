import { useMDXComponents } from "@/components/mdx"
import { docs } from "@/lib/source"
import { createFileRoute, notFound } from "@tanstack/react-router"
import { createServerFn } from "@tanstack/react-start"
import { deserializePageTree } from "fumadocs-core/source/client"
import { DocsLayout } from "fumadocs-ui/layouts/docs"
import { DocsBody, DocsDescription, DocsPage, DocsTitle } from "fumadocs-ui/layouts/docs/page"
import { Suspense, use } from "react"

const getDoc = createServerFn({ method: "GET" })
	.validator((slugs: string[]) => slugs)
	.handler(async ({ data: slugs }) => {
		const { source } = await import("@/lib/source")

		const page = source.getPage(slugs)
		if (!page) throw notFound()

		return { path: page.path, pageTree: await source.serializePageTree(source.pageTree) }
	})

export const Route = createFileRoute("/$")({
	loader: async ({ params }) => {
		// oxlint-disable-next-line no-underscore-dangle -- TanStack Router names the splat param `_splat`.
		const doc = await getDoc({ data: params._splat?.split("/") ?? [] })

		// Preloading settles the tracked load promise, so `toc` and `body` never suspend on render.
		await docs.getPage(doc.path)?.preload()

		return doc
	},
	component: Page,
})

function Page() {
	const { path, pageTree } = Route.useLoaderData()
	const page = docs.getPage(path)

	if (!page) {
		throw new Error(`unknown doc: ${path}`)
	}

	const { toc } = use(page.load())

	return (
		<DocsLayout tree={deserializePageTree(pageTree)} nav={{ title: "Talqo" }}>
			<DocsPage toc={toc}>
				<DocsTitle>{page.title}</DocsTitle>
				<DocsDescription>{page.description}</DocsDescription>
				<DocsBody>
					<Suspense>
						<page.body components={useMDXComponents()} />
					</Suspense>
				</DocsBody>
			</DocsPage>
		</DocsLayout>
	)
}
