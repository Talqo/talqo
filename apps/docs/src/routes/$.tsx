import { useMDXComponents } from "@/components/mdx"
import { docs } from "@/lib/source"
import { createFileRoute, notFound } from "@tanstack/react-router"
import { createServerFn } from "@tanstack/react-start"
import { deserializePageTree } from "fumadocs-core/source/client"
import { DocsLayout } from "fumadocs-ui/layouts/docs"
import { DocsBody, DocsDescription, DocsPage, DocsTitle } from "fumadocs-ui/layouts/docs/page"
import { Suspense, use } from "react"

const MAX_SLUGS = 32
const MAX_SLUG_CHARACTERS = 256

// Slugs arrive from the URL splat, so constrain shape and size before lookup.
function validSlugs(slugs: unknown): string[] {
	if (
		!Array.isArray(slugs) ||
		slugs.length > MAX_SLUGS ||
		!slugs.every(
			(slug): slug is string => typeof slug === "string" && slug.length > 0 && slug.length <= MAX_SLUG_CHARACTERS,
		)
	) {
		throw new Error("invalid doc slugs")
	}
	return slugs
}

const getDoc = createServerFn({ method: "GET" })
	.validator(validSlugs)
	.handler(async ({ data: slugs }) => {
		const { source } = await import("@/lib/source")

		const page = source.getPage(slugs)
		if (!page) throw notFound()

		return { path: page.path, pageTree: await source.serializePageTree(source.pageTree) }
	})

export const Route = createFileRoute("/$")({
	loader: async ({ params }) => {
		// oxlint-disable-next-line no-underscore-dangle -- TanStack Router names the splat param `_splat`.
		const slugs = (params._splat ?? "").split("/").filter((segment) => segment.length > 0)
		const doc = await getDoc({ data: slugs })

		// Preloading settles the tracked load promise, so `toc` and `body` never suspend on render.
		await docs.getPage(doc.path)?.preload()

		return doc
	},
	component: Page,
})

function Page() {
	const { path, pageTree } = Route.useLoaderData()
	const page = docs.getPage(path)

	// The loader already resolved this path server-side; if the client collection
	// disagrees, the address does not exist here either.
	if (!page) {
		throw notFound()
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
