import Content, { frontmatter, toc } from "@content/index.mdx"
import { createFileRoute } from "@tanstack/react-router"
import { DocsBody, DocsDescription, DocsPage, DocsTitle } from "fumadocs-ui/layouts/docs/page"

export const Route = createFileRoute("/docs/")({
	component: Page,
})

function Page() {
	return (
		<DocsPage toc={toc}>
			<DocsTitle>{frontmatter.title}</DocsTitle>
			<DocsDescription>{frontmatter.description}</DocsDescription>
			<DocsBody>
				<Content />
			</DocsBody>
		</DocsPage>
	)
}
