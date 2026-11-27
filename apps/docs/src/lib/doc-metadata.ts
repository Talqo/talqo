type DocMetadata = {
	description?: string
	markdownUrl: string
	title: string
	url: string
}

type DocHead = {
	meta?: Array<{ title: string } | { property: string; content: string } | { name: string; content: string }>
	links?: Array<{ rel: string; href: string; type?: string }>
}

export function docHead(loaderData: DocMetadata | undefined): DocHead {
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
}
