import { useMDXComponents } from "@/components/mdx"
import { getPageMarkdownUrl } from "@/lib/markdown"
import { isValidSlugPath, splitSlugPath } from "@/lib/slugs"
import { docs } from "@/lib/source"
import logoUrl from "@talqo/ui/assets/logo.svg"
import { createFileRoute, notFound } from "@tanstack/react-router"
import { createServerFn } from "@tanstack/react-start"
import { getRequestUrl } from "@tanstack/react-start/server"
import { deserializePageTree } from "fumadocs-core/source/client"
import { DocsLayout } from "fumadocs-ui/layouts/docs"
import {
	DocsBody,
	DocsDescription,
	DocsPage,
	DocsTitle,
	MarkdownCopyButton,
	ViewOptionsPopover,
} from "fumadocs-ui/layouts/docs/page"
import { type CSSProperties, Suspense, use } from "react"

// A mask paints the logo in currentColor, so it follows the docs theme rather than the OS color scheme.
const LOGO_MASK = { "--logo-mask": `url("${logoUrl}")` } as CSSProperties

// Slugs arrive from the URL splat, so constrain shape and size before lookup.
// Rejections are missing addresses, not server failures.
function validSlugs(slugs: unknown): string[] {
	if (!isValidSlugPath(slugs)) throw notFound()
	return slugs
}

const getDoc = createServerFn({ method: "GET" })
	.validator(validSlugs)
	.handler(async ({ data: slugs }) => {
		const { source } = await import("@/lib/source")

		const page = source.getPage(slugs)
		if (!page) throw notFound()

		const origin = getRequestUrl({ xForwardedHost: true }).origin

		return {
			path: page.path,
			title: page.data.title,
			description: page.data.description,
			url: new URL(page.url, origin).href,
			markdownUrl: new URL(getPageMarkdownUrl(page).url, origin).href,
			pageTree: await source.serializePageTree(source.pageTree),
		}
	})

export const Route = createFileRoute("/$")({
	server: {
		handlers: {
			GET: async ({ next, params, request }) => {
				// oxlint-disable-next-line no-underscore-dangle -- TanStack Router names the splat param `_splat`.
				const slugs = splitSlugPath(params._splat)
				const { negotiateMarkdown } = await import("@/lib/markdown-response")
				return (await negotiateMarkdown(request, slugs)) ?? next()
			},
		},
	},
	loader: async ({ params }) => {
		// oxlint-disable-next-line no-underscore-dangle -- TanStack Router names the splat param `_splat`.
		const slugs = splitSlugPath(params._splat)
		const doc = await getDoc({ data: slugs })

		// Preloading settles the tracked load promise, so `toc` and `body` never suspend on render.
		await docs.getPage(doc.path)?.preload()

		return doc
	},
	head: ({ loaderData }) => {
		if (!loaderData) return {}

		const { description, markdownUrl, title, url } = loaderData
		const pageTitle = new URL(url).pathname === "/" ? "Talqo Docs" : `${title} | Talqo Docs`

		return {
			meta: [
				{ title: pageTitle },
				{ property: "og:title", content: title },
				{ property: "og:type", content: "article" },
				{ property: "og:url", content: url },
				...(description
					? [
							{ name: "description", content: description },
							{ property: "og:description", content: description },
						]
					: []),
			],
			links: [
				{ rel: "canonical", href: url },
				{ rel: "alternate", type: "text/markdown", href: markdownUrl },
			],
		}
	},
	component: Page,
})

function Page() {
	const { markdownUrl, path, pageTree } = Route.useLoaderData()
	const page = docs.getPage(path)

	// The loader already resolved this path server-side; if the client collection
	// disagrees, the address does not exist here either.
	if (!page) {
		throw notFound()
	}

	const { toc } = use(page.load())

	return (
		<DocsLayout
			tree={deserializePageTree(pageTree)}
			nav={{
				title: (
					<>
						<span
							aria-hidden
							className="inline-block size-6 shrink-0 bg-current mask-(--logo-mask) mask-contain mask-center mask-no-repeat"
							style={LOGO_MASK}
						/>
						Talqo
					</>
				),
			}}
		>
			<DocsPage toc={toc}>
				<DocsTitle>{page.title}</DocsTitle>
				<DocsDescription>{page.description}</DocsDescription>
				<div className="flex flex-row items-center gap-2 border-b pt-2 pb-6">
					<MarkdownCopyButton markdownUrl={markdownUrl} />
					<ViewOptionsPopover
						markdownUrl={markdownUrl}
						githubUrl={`https://github.com/Talqo/talqo/blob/main/apps/docs/content/docs/${path}`}
					/>
				</div>
				<DocsBody>
					<Suspense>
						<page.body components={useMDXComponents()} />
					</Suspense>
				</DocsBody>
			</DocsPage>
		</DocsLayout>
	)
}
