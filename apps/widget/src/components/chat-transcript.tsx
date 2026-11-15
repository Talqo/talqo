import type { ChatAnnouncement, ChatView } from "@/lib/chat-view"
import type { ChatError, ChatMessage, ChatSnapshot } from "@talqo/sdk"
import type { RefObject } from "react"

import CircleCheckIcon from "@/assets/icons/circle-check.svg?react"
import CircleXIcon from "@/assets/icons/circle-x.svg?react"
import LoaderIcon from "@/assets/icons/loader.svg?react"
import { Markdown } from "@talqo/ui/components/markdown"
import { cn } from "@talqo/ui/lib/utils"
import { memo } from "react"
import { useTranslation } from "react-i18next"

import { errorText, outcomeText, ResponseIndicator } from "./chat-feedback"
import { Bubble, BubbleContent, BubbleGroup } from "./ui/bubble"

// Unchanged messages keep object identity through the SDK, so memo skips most rows per delta.
const TranscriptBubble = memo(function TranscriptBubble({ message }: { message: ChatMessage }) {
	const { t } = useTranslation()
	const toolStatuses = {
		running: t("toolRunning"),
		completed: t("toolCompleted"),
		failed: t("toolFailed"),
		cancelled: t("toolCancelled"),
		interrupted: t("toolInterrupted"),
	}
	const lastPart = message.parts.at(-1)
	const awaitingText =
		message.role === "assistant" &&
		message.outcome === "streaming" &&
		!message.parts.some((part) => part.type === "dynamic-tool" && part.state === "input-available") &&
		(lastPart?.type !== "text" || lastPart.text.length === 0)
	return (
		<Bubble align={message.role === "user" ? "end" : "start"}>
			<span className="tw:sr-only">{message.role === "user" ? t("youLabel") : t("agentLabel")}</span>
			{message.parts.map((part, index) => {
				const partKey = `${message.id}:${index}`
				if (part.type === "step-start" || (part.type === "text" && !part.text)) return null
				if (part.type === "text")
					return (
						<BubbleContent key={partKey} variant={message.role === "user" ? "default" : "muted"}>
							{message.role === "assistant" ? <Markdown>{part.text}</Markdown> : part.text}
						</BubbleContent>
					)
				const status =
					part.toolMetadata.outcome ??
					(part.state === "input-available" ? "running" : part.state === "output-error" ? "failed" : "completed")
				const StatusIcon = status === "running" ? LoaderIcon : status === "completed" ? CircleCheckIcon : CircleXIcon
				return (
					<output
						key={part.toolCallId}
						title={toolStatuses[status]}
						className="tw:flex tw:min-w-0 tw:max-w-full tw:items-center tw:gap-1.5 tw:break-words tw:px-1 tw:text-muted-foreground tw:text-xs"
					>
						<StatusIcon
							aria-hidden="true"
							className={cn(
								"tw:size-3.5 tw:shrink-0",
								status === "running" && "tw:animate-spin tw:motion-reduce:animate-none",
							)}
						/>
						{part.toolMetadata.source === "client" ? t("websiteTool") : t("connectedTool")}
						<span className="tw:sr-only"> {toolStatuses[status]}</span>
					</output>
				)
			})}
			{awaitingText && (
				<BubbleContent variant="muted">
					<ResponseIndicator label={t("agentResponding")} />
				</BubbleContent>
			)}
			{message.role === "assistant" && outcomeText(message.outcome, t) && (
				<span className="tw:px-1 tw:text-muted-foreground tw:text-xs">{outcomeText(message.outcome, t)}</span>
			)}
		</Bubble>
	)
})

function StatusBubble({ label }: { label: string }) {
	return (
		<Bubble align="start">
			<BubbleContent variant="muted">
				<ResponseIndicator label={label} />
			</BubbleContent>
		</Bubble>
	)
}

function ActivityStatus({ activity }: { activity: ChatSnapshot["activity"] }) {
	const { t } = useTranslation()
	if (activity !== "loading" && activity !== "recovering") return null
	return (
		<p className="tw:mt-2 tw:text-muted-foreground tw:text-sm">
			{activity === "loading" ? t("initializing") : t("recovering")}
		</p>
	)
}

function Notices({ notices }: { notices: ChatSnapshot["notices"] }) {
	const { t } = useTranslation()
	if (!notices.includes("recovery-unavailable") && !notices.includes("storage-unavailable")) return null
	return (
		<>
			{notices.includes("recovery-unavailable") && (
				<p
					role="alert"
					className="tw:mt-2 tw:rounded-surface tw:bg-destructive/10 tw:p-3 tw:text-destructive tw:text-sm"
				>
					{t("recoveryUnavailable")}
				</p>
			)}
			{notices.includes("storage-unavailable") && (
				<output className="tw:mt-2 tw:block tw:rounded-surface tw:bg-destructive/10 tw:p-3 tw:text-destructive tw:text-sm">
					{t("errorStorageUnavailable")}
				</output>
			)}
		</>
	)
}

function ErrorNotice({
	error,
	resetTime,
	canRetry,
	canStartNewChat,
	onRetry,
	onNewChat,
}: {
	error: ChatError
	resetTime?: string
	canRetry: boolean
	canStartNewChat: boolean
	onRetry: () => void
	onNewChat: () => void
}) {
	const { t } = useTranslation()
	return (
		<div
			role="alert"
			className="tw:mt-2 tw:flex tw:flex-col tw:items-start tw:gap-2 tw:rounded-surface tw:bg-destructive/10 tw:p-3 tw:text-destructive tw:text-sm"
		>
			<p>{errorText(error, t)}</p>
			{resetTime && error.retryAt && <time dateTime={error.retryAt}>{t("retryAfter", { reset: resetTime })}</time>}
			{error.retriable === true && (
				<button
					type="button"
					onClick={onRetry}
					disabled={!canRetry}
					aria-label={t("retry")}
					className="tw:rounded-control tw:border tw:border-destructive tw:px-3 tw:py-2 tw:text-destructive tw:disabled:opacity-50"
				>
					{t("retry")}
				</button>
			)}
			{error.newChatAvailable && (
				<button
					type="button"
					onClick={onNewChat}
					disabled={!canStartNewChat}
					aria-label={t("newChat")}
					className="tw:rounded-control tw:bg-primary tw:px-3 tw:py-2 tw:text-primary-foreground tw:disabled:opacity-50"
				>
					{t("newChat")}
				</button>
			)}
		</div>
	)
}

type ChatTranscriptProps = {
	view: ChatView
	scrollRef: RefObject<HTMLDivElement | null>
	onScroll: () => void
	announcement: ChatAnnouncement | null
	monitoringNoticeId: string
	onRetry: () => void
	onNewChat: () => void
}

export function ChatTranscript({
	view,
	scrollRef,
	onScroll,
	announcement,
	monitoringNoticeId,
	onRetry,
	onNewChat,
}: ChatTranscriptProps) {
	const { t } = useTranslation()
	const showGreeting = view.messages.length === 0 && view.activity === "idle"

	return (
		<>
			<div
				ref={scrollRef}
				onScroll={onScroll}
				role="log"
				aria-live="off"
				aria-label={t("transcriptLabel")}
				className="talqo-scrollbar tw:flex-1 tw:overflow-y-auto tw:p-4"
			>
				<p id={monitoringNoticeId} className="tw:pb-4 tw:text-center tw:text-muted-foreground tw:text-xs">
					{t("monitoringNotice")}
				</p>
				<BubbleGroup>
					{showGreeting && (
						<Bubble align="start">
							<span className="tw:sr-only">{t("agentLabel")}</span>
							<BubbleContent variant="muted">{t("greeting")}</BubbleContent>
						</Bubble>
					)}
					{view.messages.map((message) => (
						<TranscriptBubble key={message.id} message={message} />
					))}
					{view.activity === "sending" && <StatusBubble label={t("agentResponding")} />}
				</BubbleGroup>
				<ActivityStatus activity={view.activity} />
				<Notices notices={view.notices} />
				{view.error && (
					<ErrorNotice
						error={view.error}
						resetTime={view.resetTime}
						canRetry={view.canRetry}
						canStartNewChat={view.canStartNewChat}
						onRetry={onRetry}
						onNewChat={onNewChat}
					/>
				)}
			</div>
			<output data-testid="announcement" className="tw:sr-only">
				{announcement && <span key={announcement.id}>{announcement.text}</span>}
			</output>
		</>
	)
}
