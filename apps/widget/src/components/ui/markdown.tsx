import type { ComponentProps } from "react"

import { cn } from "@talqo/ui/lib/utils"
import ReactMarkdown, { type Components } from "react-markdown"
import remarkGfm from "remark-gfm"

/** react-markdown passes a hast `node` that must never reach the DOM element. */
type MarkdownElementProps<T extends keyof React.JSX.IntrinsicElements> = ComponentProps<T> & { node?: unknown }

function MarkdownLink({ node: _node, ...props }: MarkdownElementProps<"a">) {
	return <a {...props} target="_blank" rel="noopener noreferrer" />
}

const markdownComponents: Components = {
	a: MarkdownLink,
}

// Raw HTML never renders: no rehype-raw, so markup in model output stays inert text.
function Markdown({ children, className }: { children: string; className?: string }) {
	return (
		<div data-slot="markdown" className={cn("talqo-markdown", className)}>
			<ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
				{children}
			</ReactMarkdown>
		</div>
	)
}

export { Markdown }
