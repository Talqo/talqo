import type { ChatAnnouncement, ChatView } from "@/lib/chat-view"
import type { WidgetAppearance } from "@talqo/shared/widget-appearance"
import type { FormEvent, PointerEvent as ReactPointerEvent, RefObject } from "react"

import { useId } from "react"

import { ChatComposer } from "./chat-composer"
import { ChatHeader } from "./chat-header"
import { ChatTranscript } from "./chat-transcript"
import { ResizeHandle } from "./resize-handle"

type ColorScheme = "light" | "dark"

type PanelControls = {
	expanded: boolean
	resizable: boolean
	resizing: boolean
	startResize: (event: ReactPointerEvent<HTMLElement>) => void
	resizeBy: (widthDelta: number, heightDelta: number) => void
	toggleExpanded: () => void
}

type TranscriptState = {
	scrollRef: RefObject<HTMLDivElement | null>
	announcement: ChatAnnouncement | null
	onScroll: () => void
}

type ComposerState = {
	draft: string
	inputRef: RefObject<HTMLInputElement | null>
	onDraftChange: (value: string) => void
	onCancel: () => void
	onSubmit: (event: FormEvent<HTMLFormElement>) => void
}

type ChatPanelActions = {
	onClose: () => void
	onNewChat: () => void
	onToggleScheme: () => void
	onRetry: () => void
}

type ChatPanelContentProps = {
	title?: string
	appearance: WidgetAppearance
	scheme: ColorScheme
	panel: PanelControls
	chat: ChatView
	transcript: TranscriptState
	composer: ComposerState
	actions: ChatPanelActions
}

export function ChatPanelContent({
	title,
	appearance,
	scheme,
	panel,
	chat,
	transcript,
	composer,
	actions,
}: ChatPanelContentProps) {
	const monitoringNoticeId = useId()
	return (
		<>
			{panel.resizable && (
				<ResizeHandle
					position={appearance.position}
					expanded={panel.expanded}
					resizing={panel.resizing}
					onPointerDown={panel.startResize}
					onResizeBy={panel.resizeBy}
					onToggleExpanded={panel.toggleExpanded}
				/>
			)}
			<ChatHeader
				title={title}
				scheme={scheme}
				hasMessages={chat.messages.length > 0}
				canStartNewChat={chat.canStartNewChat}
				showThemeToggle={appearance.themeToggle}
				onClose={actions.onClose}
				onNewChat={actions.onNewChat}
				onToggleScheme={actions.onToggleScheme}
			/>
			<ChatTranscript
				view={chat}
				scrollRef={transcript.scrollRef}
				onScroll={transcript.onScroll}
				announcement={transcript.announcement}
				monitoringNoticeId={monitoringNoticeId}
				onRetry={actions.onRetry}
				onNewChat={actions.onNewChat}
			/>
			<ChatComposer
				draft={composer.draft}
				inputRef={composer.inputRef}
				monitoringNoticeId={monitoringNoticeId}
				sendAvailable={chat.sendAvailable}
				disabled={chat.composerDisabled}
				showStop={chat.showStop}
				stopping={chat.stopping}
				onDraftChange={composer.onDraftChange}
				onCancel={composer.onCancel}
				onSubmit={composer.onSubmit}
			/>
		</>
	)
}
