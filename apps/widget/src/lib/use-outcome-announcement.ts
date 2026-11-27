import type { ChatMessage } from "@talqo/sdk"

import { outcomeText } from "@/components/chat-feedback"
import { useCallback, useEffect, useRef, useState } from "react"

type Translate = (key: string) => string

type OutcomeUpdate = {
	next: Map<string, ChatMessage["outcome"]>
	terminalText?: string
}

function collectOutcomeUpdate(
	messages: ReadonlyArray<ChatMessage>,
	announced: Map<string, ChatMessage["outcome"]>,
	t: Translate,
): OutcomeUpdate {
	const next = new Map<string, ChatMessage["outcome"]>()
	let terminalText: string | undefined
	for (const message of messages) {
		if (message.role !== "assistant") continue
		next.set(message.id, message.outcome)
		if (announced.get(message.id) === "streaming" && message.outcome !== "streaming") {
			terminalText = message.outcome === "completed" ? t("responseComplete") : outcomeText(message.outcome, t)
		}
	}
	return { next, terminalText }
}

export function useOutcomeAnnouncement(messages: ReadonlyArray<ChatMessage>, open: boolean, t: Translate) {
	const [announcement, setAnnouncement] = useState<{ id: number; text: string } | null>(null)
	const announcedOutcomes = useRef(new Map<string, ChatMessage["outcome"]>())
	const announcementId = useRef(0)

	useEffect(() => {
		const { next, terminalText } = collectOutcomeUpdate(messages, announcedOutcomes.current, t)
		announcedOutcomes.current = next
		if (!open || !terminalText) return
		announcementId.current += 1
		setAnnouncement({ id: announcementId.current, text: terminalText })
	}, [messages, open, t])

	const clearAnnouncement = useCallback(() => setAnnouncement(null), [])

	return { announcement, clearAnnouncement }
}
