import type { DynamicToolUIPart, StepStartUIPart, TextUIPart } from "ai"

import type { GenerationAttemptOutcome } from "./conversation.schema.ts"

export type MessagePart =
	| TextUIPart
	| StepStartUIPart
	| (Extract<DynamicToolUIPart, { state: "input-available" | "output-available" | "output-error" }> & {
			toolMetadata: {
				source: "client" | "mcp"
				displayName: string
				serverName?: string
				outcome?: "completed" | "failed" | "cancelled" | "interrupted"
			}
	  })

export function messageText(parts: readonly MessagePart[]): string {
	return parts
		.filter((part) => part.type === "text")
		.map((part) => part.text)
		.join("")
}

export function unfinishedToolOutcome(outcome: GenerationAttemptOutcome): "cancelled" | "interrupted" | "failed" {
	return outcome === "cancelled" || outcome === "interrupted" ? outcome : "failed"
}

export function finalizePart(part: MessagePart, outcome: GenerationAttemptOutcome): MessagePart {
	if (part.type !== "dynamic-tool" || part.state !== "input-available") return part
	return {
		...part,
		state: "output-error",
		errorText: "Tool execution did not finish",
		toolMetadata: { ...part.toolMetadata, outcome: unfinishedToolOutcome(outcome) },
	}
}
