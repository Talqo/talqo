import type { ComponentProps } from "react"

import { cn } from "@talqo/ui/lib/utils"
import ReactMarkdown, { type Components, type ExtraProps } from "react-markdown"
import remarkGfm from "remark-gfm"

function MarkdownLink({ node: _node, children, ...props }: ComponentProps<"a"> & ExtraProps) {
	return (
		<a {...props} target="_blank" rel="noopener noreferrer">
			{children}
		</a>
	)
}

// Fetching a model-supplied image URL would leak the reader's IP or chat contents.
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
		<div
			data-slot="markdown"
			className={cn(
				"[&_a]:text-primary [&_code]:bg-background/60 space-y-2 [&_a]:underline [&_code]:rounded [&_code]:px-1 [&_li+li]:mt-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_pre]:overflow-x-auto [&_strong]:font-semibold [&_ul]:list-disc [&_ul]:pl-5",
				className,
			)}
		>
			<ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
				{children}
			</ReactMarkdown>
		</div>
	)
}

export { Markdown }
