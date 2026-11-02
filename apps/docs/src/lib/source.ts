import { DOCS_ROUTE } from "@/lib/markdown"
import { llms, loader } from "fumadocs-core/source"
import { defineDocs } from "fumadocs-mdx/macro"

export const docs = defineDocs({
	dir: "content/docs",
	docs: {
		async: true,
		postprocess: { includeProcessedMarkdown: { headingIds: false } },
	},
})

export const source = loader({
	baseUrl: DOCS_ROUTE,
	source: docs.toFumadocsSource(),
})

export const docsLlms = llms(source, {
	renderPage: async (page) => `# ${page.data.title} (${page.url})\n\n${await page.data.getText("processed")}`,
})
