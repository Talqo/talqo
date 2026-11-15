import type { ConversationMessage as Message } from "@/api/generated/models/conversationMessage.zod.ts"

import { Markdown } from "@talqo/ui/components/markdown"
import { cn } from "@talqo/ui/lib/utils"
import { CircleCheckIcon, CircleXIcon, LoaderCircleIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

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
	const toolStatuses = {
		running: t("conversations.toolRunning"),
		completed: t("conversations.toolCompleted"),
		failed: t("conversations.toolFailed"),
		cancelled: t("conversations.toolCancelled"),
		interrupted: t("conversations.toolInterrupted"),
	}
	return (
		<ol className="bg-foreground/8 rounded-surface p-surface-padding space-y-4 border">
			{messages.map((message) => {
				const fromVisitor = message.role === "user"
				const outcomeLabel = message.role === "assistant" ? outcomeKey(message.outcome) : undefined
				return (
					<li key={message.id} className={cn("flex flex-col gap-1", fromVisitor ? "items-end" : "items-start")}>
						<span className="text-muted-foreground px-1 text-xs">
							{fromVisitor ? t("conversations.visitor") : t("conversations.agent")}
						</span>
						{message.parts.map((part, index) => {
							const partKey = `${message.id}:${index}`
							if (part.type === "step-start" || (part.type === "text" && !part.text)) return null
							if (part.type === "dynamic-tool") {
								const status =
									part.toolMetadata.outcome ??
									(part.state === "input-available"
										? "running"
										: part.state === "output-error"
											? "failed"
											: "completed")
								const StatusIcon =
									status === "running" ? LoaderCircleIcon : status === "completed" ? CircleCheckIcon : CircleXIcon
								return (
									<output
										key={part.toolCallId}
										title={toolStatuses[status]}
										className="text-muted-foreground flex max-w-full min-w-0 items-center gap-1.5 px-1 text-xs break-words"
									>
										<StatusIcon
											aria-hidden="true"
											className={cn(
												"size-3.5 shrink-0",
												status === "running" && "animate-spin motion-reduce:animate-none",
											)}
										/>
										{part.toolMetadata.source === "client"
											? t("conversations.websiteTool")
											: t("conversations.connectedTool")}
										<span className="sr-only"> {toolStatuses[status]}</span>
									</output>
								)
							}
							return (
								<div
									key={partKey}
									className={cn(
										"max-w-[85%] rounded-2xl px-4 py-2 text-sm break-words",
										fromVisitor ? "bg-primary text-primary-foreground whitespace-pre-wrap" : "bg-card dark:bg-muted",
									)}
								>
									{fromVisitor ? part.text : <Markdown>{part.text}</Markdown>}
								</div>
							)
						})}
						{outcomeLabel && <span className="text-muted-foreground px-1 text-xs">{t(outcomeLabel)}</span>}
					</li>
				)
			})}
		</ol>
	)
}
