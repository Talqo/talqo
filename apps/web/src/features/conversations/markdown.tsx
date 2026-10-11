import type { ComponentProps } from "react"

import ReactMarkdown, { type Components } from "react-markdown"
import remarkGfm from "remark-gfm"

/** react-markdown passes a hast `node` that must never reach the DOM element. */
type LinkProps = ComponentProps<"a"> & { node?: unknown }

const components: Components = {
	a: ({ node: _node, ...props }: LinkProps) => (
		<a {...props} target="_blank" rel="noopener noreferrer" className="text-primary underline" />
	),
}

// Mirrors the widget's renderer so operators see answers as visitors did. No rehype-raw: model HTML stays inert.
export function Markdown({ children }: { children: string }) {
	return (
		<div className="[&_code]:bg-background/60 space-y-2 [&_code]:rounded [&_code]:px-1 [&_li+li]:mt-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_pre]:overflow-x-auto [&_strong]:font-semibold [&_ul]:list-disc [&_ul]:pl-5">
			<ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
				{children}
			</ReactMarkdown>
		</div>
	)
}
