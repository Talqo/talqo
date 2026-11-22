import { Transcript } from "@/features/conversations/transcript"
import { type ChatClient, type ChatError, type ChatSnapshot, createChatClient } from "@talqo/sdk"
import { Button } from "@talqo/ui/components/button"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@talqo/ui/components/card"
import { Textarea } from "@talqo/ui/components/textarea"
import { MessageSquarePlus, RotateCcw, Send, Square } from "lucide-react"
import { type FormEvent, type KeyboardEvent, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import { useTranslation } from "react-i18next"

import { createTestChatTransport } from "./test-chat-transport"

type ClientFactory = (agentId: string) => ChatClient

const HTTP_FORBIDDEN = 403

function defaultClient(agentId: string): ChatClient {
	return createChatClient({ apiUrl: window.location.origin, transport: createTestChatTransport(agentId) })
}

// Every client action reports failure through the snapshot's error, which the card renders.
function runAction(action: Promise<void>): void {
	action.catch(() => undefined)
}

/**
 * The client lives exactly as long as React's subscription, so StrictMode's simulated remount
 * gets a fresh client instead of reusing a disposed one.
 */
function createClientStore(create: () => ChatClient) {
	let client: ChatClient | undefined
	return {
		subscribe(listener: () => void) {
			const current = create()
			client = current
			const unsubscribe = current.subscribe(listener)
			runAction(current.initialize())
			listener()
			return () => {
				unsubscribe()
				current.dispose()
				if (client === current) client = undefined
			}
		},
		client: () => client,
		snapshot: () => client?.getSnapshot(),
	}
}

function useTestChatClient(agentId: string, createClient: ClientFactory) {
	const store = useMemo(() => createClientStore(() => createClient(agentId)), [agentId, createClient])
	const snapshot = useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot)
	return { client: store.client(), snapshot }
}

/** Clears the draft only once the server accepts it, so a rejected message is never lost. */
function useDraft(snapshot: ChatSnapshot | undefined) {
	const [draft, setDraft] = useState("")
	const pending = useRef<{ draft: string; acceptedMessageId: string | undefined }>(undefined)
	useEffect(() => {
		const sent = pending.current
		if (!sent || !snapshot?.acceptedMessageId || snapshot.acceptedMessageId === sent.acceptedMessageId) return
		pending.current = undefined
		setDraft((current) => (current === sent.draft ? "" : current))
	}, [snapshot?.acceptedMessageId])
	return {
		draft,
		setDraft,
		markSent: () => {
			pending.current = { draft, acceptedMessageId: snapshot?.acceptedMessageId }
		},
	}
}

const ERROR_KEYS = {
	"provider-error": "testChat.errorProvider",
	"chat-conversation-too-long": "testChat.errorTooLong",
	"chat-context-limit": "testChat.errorTooLong",
	"chat-concurrency-limit": "testChat.errorBusy",
	"chat-session-busy": "testChat.errorBusy",
	"chat-input-incompatible": "testChat.errorInput",
	"payload-too-large": "testChat.errorInput",
	"transport-error": "testChat.errorConnection",
	"cancel-failed": "testChat.errorStop",
	"reset-failed": "testChat.errorReset",
} as const satisfies Partial<Record<ChatError["code"], string>>

function errorKey(error: ChatError) {
	// Lost agent access arrives as a non-chat problem code, so the status identifies it.
	if (error.status === HTTP_FORBIDDEN) return "testChat.errorAccess"
	return error.code in ERROR_KEYS ? ERROR_KEYS[error.code as keyof typeof ERROR_KEYS] : "testChat.errorGeneric"
}

function ToolActivity({ snapshot }: { snapshot: ChatSnapshot }) {
	const { t } = useTranslation()
	const tool = snapshot.activeTools.at(-1)
	if (!tool) return null
	return (
		<output className="text-muted-foreground block text-sm">{t("testChat.usingTool", { tool: tool.toolName })}</output>
	)
}

function ChatAlert({ snapshot, client }: { snapshot: ChatSnapshot; client: ChatClient }) {
	const { t } = useTranslation()
	if (!snapshot.error) return null
	const text = t(errorKey(snapshot.error))
	return (
		<div
			role="alert"
			className="border-destructive/30 bg-destructive/10 text-destructive rounded-surface flex flex-wrap items-center justify-between gap-3 border p-3 text-sm"
		>
			<span>{text}</span>
			{snapshot.actions.includes("retry") && (
				<Button size="sm" variant="outline" onClick={() => runAction(client.retryLastMessage())}>
					<RotateCcw className="size-4" />
					{t("testChat.retry")}
				</Button>
			)}
		</div>
	)
}

function isResponding(snapshot: ChatSnapshot) {
	return snapshot.actions.includes("stop") || snapshot.activity === "stopping"
}

function Composer({ snapshot, client }: { snapshot: ChatSnapshot; client: ChatClient }) {
	const { t } = useTranslation()
	const { draft, setDraft, markSent } = useDraft(snapshot)
	const canSend = snapshot.actions.includes("send")
	const responding = isResponding(snapshot)

	function submit(event?: FormEvent) {
		event?.preventDefault()
		const text = draft.trim()
		if (!text || !canSend) return
		markSent()
		runAction(client.sendMessage(text))
	}

	function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
		if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) submit(event)
	}

	return (
		<form onSubmit={submit} className="flex items-end gap-2">
			<Textarea
				aria-label={t("testChat.messageLabel")}
				placeholder={t("testChat.placeholder")}
				value={draft}
				onChange={(event) => setDraft(event.target.value)}
				onKeyDown={onKeyDown}
				rows={2}
				className="min-h-0 flex-1 resize-none"
			/>
			{responding ? (
				<Button
					type="button"
					variant="outline"
					disabled={snapshot.activity === "stopping"}
					onClick={() => runAction(client.cancelResponse())}
				>
					<Square className="size-4" />
					{snapshot.activity === "stopping" ? t("testChat.stopping") : t("testChat.stop")}
				</Button>
			) : (
				<Button type="submit" disabled={!canSend || draft.trim() === ""}>
					<Send className="size-4" />
					{t("testChat.send")}
				</Button>
			)}
		</form>
	)
}

export function TestChatCard({
	agentId,
	createClient = defaultClient,
}: {
	agentId: string
	/** Test seam; production uses the operator transport against this origin. */
	createClient?: ClientFactory
}) {
	const { t } = useTranslation()
	const { client, snapshot } = useTestChatClient(agentId, createClient)

	return (
		<Card>
			<CardHeader>
				<CardTitle>{t("testChat.title")}</CardTitle>
				<CardDescription>{t("testChat.description")}</CardDescription>
				<CardAction>
					<Button
						variant="outline"
						size="sm"
						// Test chats are not listed in Conversations, so clearing one mid-reply would lose it for good.
						disabled={
							!client ||
							!snapshot?.actions.includes("new-chat") ||
							snapshot.messages.length === 0 ||
							isResponding(snapshot)
						}
						onClick={() => client && runAction(client.startNewChat())}
					>
						<MessageSquarePlus className="size-4" />
						{t("testChat.newChat")}
					</Button>
				</CardAction>
			</CardHeader>
			<CardContent>
				<div className="flex flex-col gap-3">
					{/* Reversed so the browser keeps the newest message in view while a reply streams. */}
					<div
						className="flex max-h-[28rem] min-h-40 flex-col-reverse overflow-y-auto"
						aria-live="polite"
						aria-busy={snapshot?.activity === "responding"}
					>
						{snapshot && snapshot.messages.length > 0 ? (
							<Transcript messages={snapshot.messages} userLabel={t("testChat.you")} />
						) : (
							<p className="text-muted-foreground rounded-surface border border-dashed p-6 text-center text-sm">
								{t("testChat.empty")}
							</p>
						)}
					</div>
					{client && snapshot && (
						<>
							<ToolActivity snapshot={snapshot} />
							<ChatAlert snapshot={snapshot} client={client} />
							<Composer snapshot={snapshot} client={client} />
						</>
					)}
				</div>
			</CardContent>
		</Card>
	)
}
