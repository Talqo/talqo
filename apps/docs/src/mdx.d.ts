declare module "*.mdx" {
	import type { TableOfContents } from "fumadocs-core/server"
	import type { ComponentType } from "react"

	export const frontmatter: {
		description?: string
		title: string
	}
	export const toc: TableOfContents

	const Component: ComponentType
	export default Component
}
