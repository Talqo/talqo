import type { ComponentProps } from "react"

import { cn } from "@talqo/ui/lib/utils"
import ReactMarkdown, { type Components, type ExtraProps } from "react-markdown"
import remarkGfm from "remark-gfm"

// react-markdown passes the hast `node` as a prop; it must never reach the DOM element.
function MarkdownLink({ node: _node, ...props }: ComponentProps<"a"> & ExtraProps) {
	return <a {...props} target="_blank" rel="noopener noreferrer" />
}

// Model output can embed an image URL that leaks the reader's IP or chat contents when fetched,
// so images stay links the reader chooses to open.
function MarkdownImage({ src, alt }: ComponentProps<"img"> & ExtraProps) {
	if (typeof src !== "string" || !src) return alt ?? null
	return (
		<a href={src} target="_blank" rel="noopener noreferrer">
			{alt || src}
		</a>
	)
}

const markdownComponents: Components = {
	a: MarkdownLink,
	img: MarkdownImage,
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
