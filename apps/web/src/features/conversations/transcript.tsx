import type { ConversationMessage as Message } from "@/api/generated/models/conversationMessage.zod.ts"

import { Markdown } from "@talqo/ui/components/markdown"
import { cn } from "@talqo/ui/lib/utils"
import { useTranslation } from "react-i18next"

// The widget styles `.talqo-markdown` in its scoped CSS; the dashboard styles it with theme tokens here.
const MARKDOWN_CLASS =
	"space-y-2 [&_a]:text-primary [&_a]:underline [&_code]:rounded [&_code]:bg-background/60 [&_code]:px-1 [&_li+li]:mt-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_pre]:overflow-x-auto [&_strong]:font-semibold [&_ul]:list-disc [&_ul]:pl-5"

const OUTCOME_KEYS = {
	streaming: "conversations.outcomeStreaming",
	failed: "conversations.outcomeFailed",
	cancelled: "conversations.outcomeCancelled",
	blocked: "conversations.outcomeBlocked",
	interrupted: "conversations.outcomeInterrupted",
} as const satisfies Partial<Record<Message["outcome"], string>>

function outcomeKey(outcome: Message["outcome"]) {
	return outcome === "completed" ? undefined : OUTCOME_KEYS[outcome]
}

export function Transcript({ messages }: { messages: Message[] }) {
	const { t } = useTranslation()
	return (
		<ol className="space-y-4">
			{messages.map((message) => {
				const fromVisitor = message.role === "user"
				const key = message.role === "assistant" ? outcomeKey(message.outcome) : undefined
				return (
					<li key={message.id} className={cn("flex flex-col gap-1", fromVisitor ? "items-end" : "items-start")}>
						<span className="text-muted-foreground px-1 text-xs">
							{fromVisitor ? t("conversations.visitor") : t("conversations.agent")}
						</span>
						{message.text.length > 0 && (
							<div
								className={cn(
									"max-w-[85%] rounded-2xl px-4 py-2 text-sm break-words",
									fromVisitor ? "bg-primary text-primary-foreground whitespace-pre-wrap" : "bg-muted",
								)}
							>
								{fromVisitor ? message.text : <Markdown className={MARKDOWN_CLASS}>{message.text}</Markdown>}
							</div>
						)}
						{key && <span className="text-muted-foreground px-1 text-xs">{t(key)}</span>}
					</li>
				)
			})}
		</ol>
	)
}
