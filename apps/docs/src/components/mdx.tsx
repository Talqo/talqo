import type { MDXComponents } from "mdx/types"

import defaultMdxComponents from "fumadocs-ui/mdx"

export function getMdxComponents(components?: MDXComponents) {
	return {
		...defaultMdxComponents,
		...components,
	} satisfies MDXComponents
}

export const useMDXComponents = getMdxComponents

declare global {
	type MDXProvidedComponents = ReturnType<typeof getMdxComponents>
}
