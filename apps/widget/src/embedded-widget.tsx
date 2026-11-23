import type { ActiveTool, ChatClient, ChatMessage, ChatSnapshot } from "@talqo/sdk"
import type { WidgetAppearance, WidgetAppearanceInput, WidgetPosition } from "@talqo/shared/widget-appearance"

import logoUrl from "@talqo/ui/assets/logo.svg"
import { cn } from "@talqo/ui/lib/utils"
import {
	type CSSProperties,
	type FormEvent,
	type PointerEvent as ReactPointerEvent,
	type RefObject,
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
	useSyncExternalStore,
} from "react"
import { I18nextProvider, useTranslation } from "react-i18next"

import type { ChatView } from "./lib/chat-view"

import { formatResetTime } from "./components/chat-feedback"
import { ChatPanelContent } from "./components/chat-panel"
import { resolveAppearance } from "./lib/appearance"
import { mergeAppearance } from "./lib/embed-config"
import { createWidgetI18n } from "./lib/i18n"
import { useOutcomeAnnouncement } from "./lib/use-outcome-announcement"
import { useResizablePanel } from "./lib/use-resizable-panel"
import { useStickyTranscript } from "./lib/use-sticky-transcript"

import "./index.css"

export type EmbeddedWidgetProps = {
	title?: string
	appearance?: WidgetAppearanceInput
	/** Preview-only: pins the scheme to whichever tab the operator is editing. */
	forcedScheme?: ColorScheme
	/** Preview-only: mirrors the deployment's reply availability without an SDK client. */
	isAvailable?: boolean
	/** Preview-only: shows the chat panel instead of just the launcher. */
	defaultOpen?: boolean
}

export type ConnectedEmbeddedWidgetProps = EmbeddedWidgetProps & {
	client: ChatClient
	disposeOnUnmount?: boolean
}

type ColorScheme = "light" | "dark"

const DARK_SCHEME_QUERY = "(prefers-color-scheme: dark)"
// Inlining the SVG would leak its favicon <style> into the host page; a mask paints it in currentColor instead.
const LOGO_MASK = { "--talqo-logo": `url("${logoUrl}")` } as CSSProperties

/** Missing `matchMedia` reads as light: the widget may mount into a document without it. */
function usePrefersDark(): boolean {
	const subscribe = useCallback((onChange: () => void) => {
		const media = globalThis.matchMedia?.(DARK_SCHEME_QUERY)
		media?.addEventListener("change", onChange)
		return () => media?.removeEventListener("change", onChange)
	}, [])

	return useSyncExternalStore(
		subscribe,
		() => globalThis.matchMedia?.(DARK_SCHEME_QUERY)?.matches ?? false,
		() => false,
	)
}

const positionClasses: Record<WidgetPosition, string> = {
	"bottom-right": "tw:fixed tw:right-4 tw:bottom-4 tw:items-end",
	"bottom-left": "tw:fixed tw:bottom-4 tw:left-4 tw:items-start",
}

// showModal() moves the panel into the top layer, so it no longer inherits the launcher wrapper's position.
const panelPositionClasses: Record<WidgetPosition, string> = {
	"bottom-right": "tw:right-4 tw:bottom-[4.75rem] tw:left-auto tw:top-auto",
	"bottom-left": "tw:bottom-[4.75rem] tw:left-4 tw:right-auto tw:top-auto",
}

function closeOnBackdropPointerDown(event: ReactPointerEvent<HTMLDialogElement>, onClose: () => void) {
	if (event.target !== event.currentTarget) return
	const rect = event.currentTarget.getBoundingClientRect()
	const outside =
		event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom
	if (outside) onClose()
}

const EMPTY_MESSAGES: ReadonlyArray<ChatMessage> = []
const EMPTY_TOOLS: ReadonlyArray<ActiveTool> = []
const EMPTY_NOTICES: ChatSnapshot["notices"] = []
const EMPTY_ACTIONS: ChatSnapshot["actions"] = []

function chatView(snapshot: ChatSnapshot | undefined, language: string): ChatView {
	const activity = snapshot?.activity ?? "idle"
	const actions = snapshot?.actions ?? EMPTY_ACTIONS
	const error = snapshot?.error
	return {
		messages: snapshot?.messages ?? EMPTY_MESSAGES,
		activeTools: snapshot?.activeTools ?? EMPTY_TOOLS,
		notices: snapshot?.notices ?? EMPTY_NOTICES,
		activity,
		error,
		resetTime: error?.retryAt ? formatResetTime(error.retryAt, language) : undefined,
		sendAvailable: snapshot ? actions.includes("send") : true,
		composerDisabled: snapshot !== undefined && activity === "blocked",
		canStartNewChat: actions.includes("new-chat"),
		canRetry: actions.includes("retry"),
		showStop: actions.includes("stop") || activity === "stopping",
		stopping: activity === "stopping",
	}
}

function useChatDialog(defaultOpen: boolean | undefined) {
	const [open, setOpen] = useState(defaultOpen ?? false)
	const launcherRef = useRef<HTMLButtonElement>(null)
	const panelRef = useRef<HTMLDialogElement>(null)
	const inputRef = useRef<HTMLInputElement>(null)
	// The preview opens without modal focus: trapping Tab inside the dashboard's frame would
	// strand keyboard users in the widget.
	const openWithoutFocus = useRef(defaultOpen === true)
	const wasOpen = useRef(false)

	useEffect(() => {
		if (wasOpen.current && !open) {
			launcherRef.current?.focus()
		}
		wasOpen.current = open
	}, [open])

	useLayoutEffect(() => {
		if (!open) return undefined
		const dialog = panelRef.current
		if (!dialog) return undefined
		if (openWithoutFocus.current) {
			openWithoutFocus.current = false
			dialog.show()
			// Chrome still focuses the dialog's first control; hand focus back to the dashboard.
			window.parent.focus()
		} else {
			dialog.showModal()
			inputRef.current?.focus()
		}
		return () => {
			dialog.close()
		}
	}, [open])

	function toggle() {
		setOpen((previous) => !previous)
	}

	function close() {
		setOpen(false)
	}

	return { open, toggle, close, launcherRef, panelRef, inputRef }
}

function useChatScheme(appearance: WidgetAppearance, forcedScheme: ColorScheme | undefined) {
	const [visitorScheme, setVisitorScheme] = useState<ColorScheme | null>(null)
	const prefersDark = usePrefersDark()
	const operatorScheme: ColorScheme =
		appearance.theme === "system" ? (prefersDark ? "dark" : "light") : appearance.theme
	const scheme = forcedScheme ?? visitorScheme ?? operatorScheme
	const active = scheme === "dark" ? appearance.dark : appearance.light

	function toggle() {
		setVisitorScheme(scheme === "dark" ? "light" : "dark")
	}

	return { scheme, active, toggle }
}

function useChatDraft(
	snapshot: ChatSnapshot | undefined,
	client: ChatClient | undefined,
	sendAvailable: boolean,
	pinToBottom: () => void,
	inputRef: RefObject<HTMLInputElement | null>,
) {
	const [draft, setDraft] = useState("")
	const pendingSend = useRef<{ draft: string; acceptedMessageId: string | undefined } | undefined>(undefined)

	useEffect(() => {
		const pending = pendingSend.current
		if (!pending || !snapshot?.acceptedMessageId || snapshot.acceptedMessageId === pending.acceptedMessageId) return
		pendingSend.current = undefined
		setDraft((current) => (current === pending.draft ? "" : current))
	}, [snapshot?.acceptedMessageId])

	async function handleSend(event: FormEvent<HTMLFormElement>) {
		event.preventDefault()
		const text = draft.trim()
		if (!text || !sendAvailable || !client) {
			return
		}
		pendingSend.current = { draft, acceptedMessageId: snapshot?.acceptedMessageId }
		pinToBottom()
		inputRef.current?.focus()
		try {
			await client.sendMessage(text)
		} catch {
			// An uncertain send can still be accepted during SDK recovery.
		}
	}

	return { draft, setDraft, handleSend }
}

function createChatActions(
	client: ChatClient | undefined,
	canStartNewChat: boolean,
	pinToBottom: () => void,
	inputRef: RefObject<HTMLInputElement | null>,
) {
	async function startNewChat() {
		if (!canStartNewChat || !client) return
		pinToBottom()
		try {
			await client.startNewChat()
			inputRef.current?.focus()
		} catch {
			// The SDK snapshot owns the reset failure and retained transcript.
		}
	}

	async function cancel() {
		inputRef.current?.focus()
		try {
			await client?.cancelResponse()
		} catch {
			// The SDK snapshot owns cancellation recovery and errors.
		}
	}

	async function retry() {
		pinToBottom()
		try {
			await client?.retryLastMessage()
		} catch {
			// The SDK snapshot owns retry failures and recovery.
		}
	}

	return { startNewChat, cancel, retry }
}

function WidgetChat({
	title,
	appearance,
	defaultOpen,
	forcedScheme,
	snapshot,
	client,
}: {
	title?: string
	appearance: WidgetAppearance
	defaultOpen?: boolean
	forcedScheme?: ColorScheme
	snapshot?: ChatSnapshot
	client?: ChatClient
}) {
	const { t, i18n } = useTranslation()
	const chat = chatView(snapshot, i18n.language)
	const { open: chatOpen, toggle, close, launcherRef, panelRef, inputRef } = useChatDialog(defaultOpen)
	const scheme = useChatScheme(appearance, forcedScheme)
	const panel = useResizablePanel(appearance.position, panelRef)
	const panelStyle: CSSProperties = panel.size ? { width: panel.size.width, height: panel.size.height } : {}
	const { announcement, clearAnnouncement } = useOutcomeAnnouncement(chat.messages, chatOpen, t)
	const transcript = useStickyTranscript(chatOpen)
	const composer = useChatDraft(snapshot, client, chat.sendAvailable, transcript.pinToBottom, inputRef)
	const actions = createChatActions(client, chat.canStartNewChat, transcript.pinToBottom, inputRef)

	function closeChat() {
		clearAnnouncement()
		close()
	}

	function toggleChat() {
		if (chatOpen) {
			clearAnnouncement()
		}
		toggle()
	}

	const paletteStyle = {
		"--talqo-primary-input": scheme.active.primary,
		"--talqo-text-on-primary-input": scheme.active.textOnPrimary,
		"--talqo-background-input": scheme.active.background,
		"--talqo-surface-input": scheme.active.surface,
		"--talqo-text-input": scheme.active.text,
	} as CSSProperties

	return (
		<div
			className={cn(
				"talqo-widget tw:flex tw:flex-col tw:gap-3 tw:font-sans tw:text-foreground",
				positionClasses[appearance.position],
				scheme.scheme === "dark" && "dark",
			)}
			style={paletteStyle}
			data-scheme={scheme.scheme}
			lang={appearance.language}
		>
			{chatOpen && (
				// Anchored 4.75rem above the viewport bottom (offset + launcher + gap); max-h keeps 1rem above.
				<dialog
					aria-label={title ?? t("defaultTitle")}
					ref={panelRef}
					className={cn(
						"tw:group tw:fixed tw:m-0 tw:flex tw:h-96 tw:w-80 tw:max-h-[calc(100dvh-5.75rem)] tw:max-w-[calc(100vw-2rem)] tw:flex-col tw:overflow-hidden tw:rounded-overlay tw:border tw:border-border tw:bg-background tw:p-0 tw:text-foreground tw:shadow-lg",
						panelPositionClasses[appearance.position],
					)}
					style={panelStyle}
					onPointerDown={(event) => closeOnBackdropPointerDown(event, closeChat)}
					onCancel={(event) => {
						event.preventDefault()
						closeChat()
					}}
				>
					<ChatPanelContent
						title={title}
						appearance={appearance}
						scheme={scheme.scheme}
						panel={{ ...panel, expanded: panel.size !== null }}
						chat={chat}
						transcript={{ scrollRef: transcript.scrollRef, announcement, onScroll: transcript.onScroll }}
						composer={{
							draft: composer.draft,
							inputRef,
							onDraftChange: composer.setDraft,
							onCancel: () => void actions.cancel(),
							onSubmit: (event) => void composer.handleSend(event),
						}}
						actions={{
							onClose: closeChat,
							onNewChat: () => void actions.startNewChat(),
							onToggleScheme: scheme.toggle,
							onRetry: () => void actions.retry(),
						}}
					/>
				</dialog>
			)}
			<button
				type="button"
				ref={launcherRef}
				onClick={toggleChat}
				aria-label={chatOpen ? t("closeChat") : t("openChat")}
				aria-expanded={chatOpen}
				aria-haspopup="dialog"
				className="tw:flex tw:size-12 tw:items-center tw:justify-center tw:rounded-full tw:bg-primary tw:text-primary-foreground tw:shadow-lg tw:transition-transform tw:hover:scale-105"
			>
				<span
					aria-hidden="true"
					className="tw:size-7 tw:bg-current tw:mask-(--talqo-logo) tw:mask-contain tw:mask-center tw:mask-no-repeat"
					style={LOGO_MASK}
				/>
			</button>
		</div>
	)
}

export function EmbeddedWidget({ title, appearance, defaultOpen, forcedScheme, isAvailable }: EmbeddedWidgetProps) {
	const resolved = resolveAppearance(appearance)
	const [i18n] = useState(() => createWidgetI18n(resolved.language))

	useEffect(() => {
		void i18n.changeLanguage(resolved.language)
	}, [i18n, resolved.language])

	if (isAvailable === false) return null

	return (
		<I18nextProvider i18n={i18n}>
			<WidgetChat title={title} appearance={resolved} defaultOpen={defaultOpen} forcedScheme={forcedScheme} />
		</I18nextProvider>
	)
}

export function ConnectedEmbeddedWidget({
	client,
	title,
	appearance,
	forcedScheme,
	defaultOpen,
	disposeOnUnmount = true,
}: ConnectedEmbeddedWidgetProps) {
	const snapshot = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot)

	useEffect(() => {
		void client.initialize().catch((cause: unknown) => console.warn("TalqoWidget: initialization failed", cause))
		return () => {
			if (disposeOnUnmount) client.dispose()
		}
	}, [client, disposeOnUnmount])

	if (!snapshot.isAvailable) {
		return null
	}

	return (
		<ConnectedWidgetContent
			client={client}
			snapshot={snapshot}
			title={title}
			appearance={appearance}
			forcedScheme={forcedScheme}
			defaultOpen={defaultOpen}
		/>
	)
}

function ConnectedWidgetContent({
	client,
	snapshot,
	title,
	appearance,
	forcedScheme,
	defaultOpen,
}: ConnectedEmbeddedWidgetProps & { snapshot: ChatSnapshot }) {
	const configuredAppearance = (snapshot.configuration?.appearance ?? {}) as WidgetAppearanceInput
	const resolved = resolveAppearance(mergeAppearance(configuredAppearance, appearance ?? {}))
	const [i18n] = useState(() => createWidgetI18n(resolved.language))

	useEffect(() => {
		void i18n.changeLanguage(resolved.language)
	}, [i18n, resolved.language])

	return (
		<I18nextProvider i18n={i18n}>
			<WidgetChat
				title={title ?? snapshot.configuration?.title}
				appearance={resolved}
				forcedScheme={forcedScheme}
				defaultOpen={defaultOpen}
				snapshot={snapshot}
				client={client}
			/>
		</I18nextProvider>
	)
}
