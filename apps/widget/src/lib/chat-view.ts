import type { ChatError, ChatMessage, ChatSnapshot } from "@talqo/sdk"

export type ChatAnnouncement = { id: number; text: string }

export type ChatView = {
	messages: readonly ChatMessage[]
	notices: ChatSnapshot["notices"]
	activity: ChatSnapshot["activity"]
	error: ChatError | undefined
	resetTime: string | undefined
	sendAvailable: boolean
	composerDisabled: boolean
	canStartNewChat: boolean
	canRetry: boolean
	showStop: boolean
	stopping: boolean
}
