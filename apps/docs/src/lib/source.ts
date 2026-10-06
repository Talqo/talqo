import { loader } from "fumadocs-core/source"
import { defineDocs } from "fumadocs-mdx/macro"

export const docs = defineDocs({
	dir: "content/docs",
	docs: { async: true },
})

export const source = loader({
	baseUrl: "/",
	source: docs.toFumadocsSource(),
})
