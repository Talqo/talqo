type TranscriptPart =
	{ type: "step-start" } | { type: "text"; text: string } | { type: "dynamic-tool"; toolCallId: string }

export type TranscriptGroup<TPart extends TranscriptPart> =
	| { kind: "text"; part: Extract<TPart, { type: "text" }>; index: number }
	| { kind: "tool"; part: Extract<TPart, { type: "dynamic-tool" }>; groupKey: string }
	| { kind: "tools"; parts: Array<Extract<TPart, { type: "dynamic-tool" }>>; groupKey: string }

function isTextPart<TPart extends TranscriptPart>(part: TPart): part is Extract<TPart, { type: "text" }> {
	return part.type === "text"
}

function isToolPart<TPart extends TranscriptPart>(part: TPart): part is Extract<TPart, { type: "dynamic-tool" }> {
	return part.type === "dynamic-tool"
}

function appendToolPart<TPart extends TranscriptPart>(
	groups: Array<TranscriptGroup<TPart>>,
	part: Extract<TPart, { type: "dynamic-tool" }>,
): void {
	const last = groups.at(-1)
	if (last?.kind === "tools") last.parts.push(part)
	else if (last?.kind === "tool")
		groups[groups.length - 1] = { kind: "tools", parts: [last.part, part], groupKey: last.groupKey }
	else groups.push({ kind: "tool", part, groupKey: part.toolCallId })
}

/** Groups visible transcript parts, collecting each adjacent run of tool calls so a UI can collapse it. */
export function groupTranscriptParts<TPart extends TranscriptPart>(
	parts: ReadonlyArray<TPart>,
): Array<TranscriptGroup<TPart>> {
	const groups: Array<TranscriptGroup<TPart>> = []
	parts.forEach((part, index) => {
		if (isTextPart(part)) {
			if (part.text.length > 0) groups.push({ kind: "text", part, index })
		} else if (isToolPart(part)) appendToolPart(groups, part)
	})
	return groups
}
