type TranscriptPart =
	{ type: "step-start" } | { type: "text"; text: string } | { type: "dynamic-tool"; toolCallId: string }

export type TranscriptGroup<TPart extends TranscriptPart> =
	| { kind: "text"; part: Extract<TPart, { type: "text" }>; index: number }
	| { kind: "tool"; part: Extract<TPart, { type: "dynamic-tool" }>; groupKey: string }
	| { kind: "tools"; parts: Extract<TPart, { type: "dynamic-tool" }>[]; groupKey: string }

function isTextPart<TPart extends TranscriptPart>(part: TPart): part is Extract<TPart, { type: "text" }> {
	return part.type === "text"
}

function isToolPart<TPart extends TranscriptPart>(part: TPart): part is Extract<TPart, { type: "dynamic-tool" }> {
	return part.type === "dynamic-tool"
}

/** Groups visible transcript parts, collecting each adjacent run of tool calls so a UI can collapse it. */
export function groupTranscriptParts<TPart extends TranscriptPart>(parts: readonly TPart[]): TranscriptGroup<TPart>[] {
	const groups: TranscriptGroup<TPart>[] = []
	parts.forEach((part, index) => {
		if (part.type === "step-start") return
		if (isTextPart(part)) {
			if (part.text.length > 0) groups.push({ kind: "text", part, index })
			return
		}
		if (!isToolPart(part)) return
		const last = groups.at(-1)
		if (last?.kind === "tools") last.parts.push(part)
		else if (last?.kind === "tool")
			groups[groups.length - 1] = { kind: "tools", parts: [last.part, part], groupKey: last.groupKey }
		else groups.push({ kind: "tool", part, groupKey: part.toolCallId })
	})
	return groups
}
