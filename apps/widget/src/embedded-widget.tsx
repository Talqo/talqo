import type { ActiveTool, ChatClient, ChatMessage, ChatSnapshot } from "@talqo/sdk"

import {
	DEFAULT_WIDGET_APPEARANCE,
	isHexColor,
	isWidgetPosition,
	isWidgetTheme,
	type WidgetAppearance,
	type WidgetAppearanceInput,
	type WidgetPosition,
	type WidgetScheme,
	type WidgetSchemeInput,
} from "@talqo/shared/widget-appearance"
import { Markdown } from "@talqo/ui/components/markdown"
import { cn } from "@talqo/ui/lib/utils"
import {
	type CSSProperties,
	type FormEvent,
	type KeyboardEvent,
	memo,
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
	useSyncExternalStore,
} from "react"
import { I18nextProvider, useTranslation } from "react-i18next"

import ChatIcon from "./assets/icons/chat.svg?react"
import CloseIcon from "./assets/icons/close.svg?react"
import MoonIcon from "./assets/icons/moon.svg?react"
import NewChatIcon from "./assets/icons/new-chat.svg?react"
import ResizeGripIcon from "./assets/icons/resize-grip.svg?react"
import SendIcon from "./assets/icons/send.svg?react"
import StopIcon from "./assets/icons/stop.svg?react"
import SunIcon from "./assets/icons/sun.svg?react"
import { errorText, outcomeText, ResponseIndicator } from "./components/chat-feedback"
import { Bubble, BubbleContent, BubbleGroup } from "./components/ui/bubble"
import { mergeAppearance } from "./lib/embed-config"
import { createWidgetI18n, isWidgetLanguage } from "./lib/i18n"
import { useResizablePanel } from "./lib/use-resizable-panel"

import "./index.css"

export type EmbeddedWidgetProps = {
	title?: string
	appearance?: WidgetAppearanceInput
	/** Preview-only: pins the scheme to whichever tab the operator is editing. */
	forcedScheme?: ColorScheme
	/** Preview-only: mirrors the deployment's reply availability without an SDK client. */
	isAvailable?: boolean
}

export type ConnectedEmbeddedWidgetProps = EmbeddedWidgetProps & {
	client: ChatClient
}

type ColorScheme = "light" | "dark"

const DARK_SCHEME_QUERY = "(prefers-color-scheme: dark)"

// Unchanged messages keep object identity through the SDK, so memo skips most rows per delta.
const TranscriptBubble = memo(function TranscriptBubble({ message }: { message: ChatMessage }) {
	const { t } = useTranslation()
	const awaitingText = message.role === "assistant" && message.outcome === "streaming" && message.text.length === 0
	return (
		<Bubble align={message.role === "user" ? "end" : "start"}>
			{(awaitingText || message.text.length > 0) && (
				<BubbleContent
					variant={message.role === "user" ? "default" : "muted"}
					className={cn(message.role === "assistant" && "tw:text-foreground")}
				>
					{awaitingText ? (
						<ResponseIndicator label={t("agentResponding")} />
					) : message.role === "assistant" ? (
						<Markdown>{message.text}</Markdown>
					) : (
						message.text
					)}
				</BubbleContent>
			)}
			{message.role === "assistant" && outcomeText(message.outcome, t) && (
				<span className="tw:px-1 tw:text-muted-foreground tw:text-xs">{outcomeText(message.outcome, t)}</span>
			)}
		</Bubble>
	)
})

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

function resolveScheme(input: WidgetSchemeInput | undefined, fallback: WidgetScheme): WidgetScheme {
	return {
		primary: isHexColor(input?.primary) ? input.primary : fallback.primary,
		textOnPrimary: isHexColor(input?.textOnPrimary) ? input.textOnPrimary : fallback.textOnPrimary,
		background: isHexColor(input?.background) ? input.background : fallback.background,
		surface: isHexColor(input?.surface) ? input.surface : fallback.surface,
		text: isHexColor(input?.text) ? input.text : fallback.text,
	}
}

/**
 * Falls back per field: an invalid hex reaching a var() invalidates every declaration
 * referencing it, blanking the whole widget instead of degrading one color.
 */
function resolveAppearance(appearance: WidgetAppearanceInput | undefined): WidgetAppearance {
	return {
		light: resolveScheme(appearance?.light, DEFAULT_WIDGET_APPEARANCE.light),
		dark: resolveScheme(appearance?.dark, DEFAULT_WIDGET_APPEARANCE.dark),
		position: isWidgetPosition(appearance?.position) ? appearance.position : DEFAULT_WIDGET_APPEARANCE.position,
		theme: isWidgetTheme(appearance?.theme) ? appearance.theme : DEFAULT_WIDGET_APPEARANCE.theme,
		themeToggle:
			typeof appearance?.themeToggle === "boolean" ? appearance.themeToggle : DEFAULT_WIDGET_APPEARANCE.themeToggle,
		language: isWidgetLanguage(appearance?.language) ? appearance.language : DEFAULT_WIDGET_APPEARANCE.language,
	}
}

function trapFocus(event: KeyboardEvent<HTMLDivElement>, container: HTMLElement | null) {
	if (event.key !== "Tab" || !container) {
		return
	}
	const focusable = container.querySelectorAll<HTMLElement>("button, input")
	const first = focusable.item(0)
	const last = focusable.item(focusable.length - 1)
	if (!first || !last) {
		return
	}
	if (event.shiftKey && document.activeElement === first) {
		event.preventDefault()
		last.focus()
	} else if (!event.shiftKey && document.activeElement === last) {
		event.preventDefault()
		first.focus()
	}
}

const EMPTY_MESSAGES: readonly ChatMessage[] = []
const EMPTY_TOOLS: readonly ActiveTool[] = []

const STICKY_SCROLL_THRESHOLD_PX = 48

function WidgetChat({
	title,
	appearance,
	forcedScheme,
	snapshot,
	client,
}: {
	title?: string
	appearance: WidgetAppearance
	forcedScheme?: ColorScheme
	snapshot?: ChatSnapshot
	client?: ChatClient
}) {
	const { t } = useTranslation()
	const [open, setOpen] = useState(false)
	const [draft, setDraft] = useState("")
	const [visitorScheme, setVisitorScheme] = useState<ColorScheme | null>(null)
	const launcherRef = useRef<HTMLButtonElement>(null)
	const panelRef = useRef<HTMLDivElement>(null)
	const inputRef = useRef<HTMLInputElement>(null)
	const draftRef = useRef("")
	const pendingSend = useRef<{ draft: string; acceptedMessageId: string | undefined } | undefined>(undefined)
	const wasOpen = useRef(false)
	const scrollRef = useRef<HTMLDivElement>(null)
	const stickToBottomRef = useRef(true)
	const prefersDark = usePrefersDark()
	const position = appearance.position
	const { size, resizable, startResize, resizing } = useResizablePanel(position, panelRef)
	const messages = snapshot?.messages ?? EMPTY_MESSAGES
	const activeTools = snapshot?.activeTools ?? EMPTY_TOOLS
	const activity = snapshot?.activity ?? "idle"
	const disabled = snapshot ? !snapshot.actions.includes("send") : false
	const visibleError = snapshot?.error
	const canStartNewChat = snapshot?.actions.includes("new-chat") === true

	useEffect(() => {
		draftRef.current = draft
	}, [draft])

	useEffect(() => {
		const pending = pendingSend.current
		if (!pending || !snapshot?.acceptedMessageId || snapshot.acceptedMessageId === pending.acceptedMessageId) return
		pendingSend.current = undefined
		if (draftRef.current === pending.draft) setDraft("")
	}, [snapshot?.acceptedMessageId])

	useEffect(() => {
		if (wasOpen.current && !open) {
			launcherRef.current?.focus()
		}
		wasOpen.current = open
	}, [open])

	const scrollToBottom = useCallback(() => {
		const element = scrollRef.current
		if (element) {
			element.scrollTop = element.scrollHeight
		}
	}, [])

	function handleTranscriptScroll() {
		const element = scrollRef.current
		if (!element) return
		stickToBottomRef.current =
			element.scrollHeight - element.scrollTop - element.clientHeight <= STICKY_SCROLL_THRESHOLD_PX
	}

	useLayoutEffect(() => {
		if (open) {
			stickToBottomRef.current = true
			scrollToBottom()
		}
	}, [open, scrollToBottom])

	// No deps: re-pins after every commit while the visitor is at the bottom.
	useLayoutEffect(() => {
		if (open && stickToBottomRef.current) {
			scrollToBottom()
		}
	})

	const operatorScheme: ColorScheme =
		appearance.theme === "system" ? (prefersDark ? "dark" : "light") : appearance.theme
	const scheme = forcedScheme ?? visitorScheme ?? operatorScheme
	const active = scheme === "dark" ? appearance.dark : appearance.light

	async function handleSend(event: FormEvent<HTMLFormElement>) {
		event.preventDefault()
		const text = draft.trim()
		if (!text || disabled || !client) {
			return
		}
		pendingSend.current = { draft, acceptedMessageId: snapshot?.acceptedMessageId }
		stickToBottomRef.current = true
		try {
			await client.sendMessage(text)
		} catch {
			// An uncertain send can still be accepted during SDK recovery.
		}
	}

	async function handleNewChat() {
		if (!canStartNewChat || !client) return
		stickToBottomRef.current = true
		try {
			await client.startNewChat()
			inputRef.current?.focus()
		} catch {
			// The SDK snapshot owns the reset failure and retained transcript.
		}
	}

	async function handleCancel() {
		try {
			await client?.cancelResponse()
		} catch {
			// The SDK snapshot owns cancellation recovery and errors.
		}
	}

	async function handleRetry() {
		stickToBottomRef.current = true
		try {
			await client?.retryLastMessage()
		} catch {
			// The SDK snapshot owns retry failures and recovery.
		}
	}

	const paletteStyle = {
		"--talqo-primary-input": active.primary,
		"--talqo-text-on-primary-input": active.textOnPrimary,
		"--talqo-background-input": active.background,
		"--talqo-surface-input": active.surface,
		"--talqo-text-input": active.text,
	} as CSSProperties

	const panelStyle: CSSProperties = size ? { width: size.width, height: size.height } : {}

	return (
		<div
			className={cn(
				"talqo-widget tw:flex tw:flex-col tw:gap-3 tw:font-sans tw:text-foreground",
				positionClasses[appearance.position],
				scheme === "dark" && "dark",
			)}
			style={paletteStyle}
			data-scheme={scheme}
		>
			{open && (
				// max-h leaves room below for the launcher row plus a top clearance:
				// 16px offset + 12px gap + 48px launcher + 16px clearance = 5.75rem.
				<div
					role="dialog"
					aria-label={title ?? t("defaultTitle")}
					ref={panelRef}
					className="tw:group tw:relative tw:flex tw:h-96 tw:w-80 tw:max-h-[calc(100vh-5.75rem)] tw:max-w-[calc(100vw-2rem)] tw:flex-col tw:overflow-hidden tw:rounded-overlay tw:border tw:border-border tw:bg-background tw:shadow-lg"
					style={panelStyle}
					onKeyDown={(event) => {
						if (event.key === "Escape") {
							setOpen(false)
						} else {
							trapFocus(event, panelRef.current)
						}
					}}
				>
					{resizable && (
						<div
							aria-hidden="true"
							data-testid="resize-corner"
							className={cn(
								"tw:absolute tw:z-10 tw:size-6 tw:transition-opacity",
								position === "bottom-left"
									? "tw:-top-1.5 tw:-right-1.5 tw:cursor-nesw-resize"
									: "tw:-top-1.5 tw:-left-1.5 tw:cursor-nwse-resize",
								resizing ? "tw:opacity-100" : "tw:opacity-0 tw:group-hover:opacity-100",
							)}
							onPointerDown={startResize}
						>
							<ResizeGripIcon
								aria-hidden="true"
								className={cn(
									"tw:size-full tw:transition-colors",
									position === "bottom-left" && "tw:-scale-x-100",
									resizing ? "tw:text-primary" : "tw:text-muted-foreground",
								)}
							/>
						</div>
					)}
					<header className="tw:flex tw:items-center tw:justify-between tw:border-border tw:border-b tw:px-4 tw:py-3.5">
						<h2 className="tw:font-semibold tw:text-sm">{title ?? t("defaultTitle")}</h2>
						<div className="tw:flex tw:items-center tw:gap-1">
							{messages.length > 0 && (
								<button
									type="button"
									onClick={() => void handleNewChat()}
									disabled={!canStartNewChat}
									aria-label={t("newChat")}
									title={t("newChatTooltip")}
									className="tw:mr-1 tw:flex tw:size-6 tw:items-center tw:justify-center tw:rounded-control tw:text-muted-foreground tw:transition-colors tw:hover:text-foreground tw:disabled:opacity-50"
								>
									<NewChatIcon aria-hidden="true" />
								</button>
							)}
							{appearance.themeToggle && (
								<button
									type="button"
									onClick={() => setVisitorScheme(scheme === "dark" ? "light" : "dark")}
									aria-label={scheme === "dark" ? t("switchToLight") : t("switchToDark")}
									className="tw:flex tw:size-6 tw:items-center tw:justify-center tw:rounded-control tw:text-muted-foreground tw:transition-colors tw:hover:text-foreground"
								>
									{scheme === "dark" ? <SunIcon aria-hidden="true" /> : <MoonIcon aria-hidden="true" />}
								</button>
							)}
							<button
								type="button"
								onClick={() => setOpen(false)}
								aria-label={t("closeChat")}
								className="tw:flex tw:size-6 tw:items-center tw:justify-center tw:rounded-control tw:text-muted-foreground tw:transition-colors tw:hover:text-foreground"
							>
								<CloseIcon aria-hidden="true" />
							</button>
						</div>
					</header>
					<div
						ref={scrollRef}
						onScroll={handleTranscriptScroll}
						className="talqo-scrollbar tw:flex-1 tw:overflow-y-auto tw:p-4"
					>
						<BubbleGroup>
							{messages.length === 0 && activity === "idle" && (
								<Bubble align="start">
									<BubbleContent variant="muted" className="tw:text-foreground">
										{t("greeting")}
									</BubbleContent>
								</Bubble>
							)}
							{messages.map((message) => (
								<TranscriptBubble key={message.id} message={message} />
							))}
							{activeTools.length > 0 && (
								<Bubble align="start">
									<BubbleContent variant="muted" className="tw:text-foreground">
										<ResponseIndicator label={t("toolRunning")} />
									</BubbleContent>
								</Bubble>
							)}
							{activity === "sending" && (
								<Bubble align="start">
									<BubbleContent variant="muted" className="tw:text-foreground">
										<ResponseIndicator label={t("agentResponding")} />
									</BubbleContent>
								</Bubble>
							)}
							{activity === "loading" && <p className="tw:text-muted-foreground tw:text-sm">{t("initializing")}</p>}
							{activity === "recovering" && <p className="tw:text-muted-foreground tw:text-sm">{t("recovering")}</p>}
							{snapshot?.notices.includes("recovery-unavailable") && (
								<p
									role="alert"
									className="tw:rounded-surface tw:bg-destructive/10 tw:p-3 tw:text-destructive tw:text-sm"
								>
									{t("recoveryUnavailable")}
								</p>
							)}
							{snapshot?.notices.includes("storage-unavailable") && (
								<p
									role="status"
									className="tw:rounded-surface tw:bg-destructive/10 tw:p-3 tw:text-destructive tw:text-sm"
								>
									{t("errorStorageUnavailable")}
								</p>
							)}
							{visibleError && (
								<div
									role="alert"
									className="tw:flex tw:flex-col tw:items-start tw:gap-2 tw:rounded-surface tw:bg-destructive/10 tw:p-3 tw:text-destructive tw:text-sm"
								>
									<p>{errorText(visibleError, t)}</p>
									{visibleError.retryAt && (
										<time dateTime={visibleError.retryAt}>
											{t("retryAfter", {
												reset: new Date(visibleError.retryAt).toLocaleString(),
											})}
										</time>
									)}
									{visibleError.retriable === true && (
										<button
											type="button"
											onClick={() => void handleRetry()}
											disabled={!snapshot?.actions.includes("retry")}
											aria-label={t("retry")}
											className="tw:rounded-control tw:border tw:border-destructive tw:px-3 tw:py-2 tw:text-destructive tw:disabled:opacity-50"
										>
											{t("retry")}
										</button>
									)}
									{visibleError.newChatAvailable && (
										<button
											type="button"
											onClick={() => void handleNewChat()}
											disabled={!canStartNewChat}
											aria-label={t("newChat")}
											className="tw:rounded-control tw:bg-primary tw:px-3 tw:py-2 tw:text-primary-foreground tw:disabled:opacity-50"
										>
											{t("newChat")}
										</button>
									)}
								</div>
							)}
						</BubbleGroup>
					</div>
					<form onSubmit={handleSend} className="tw:flex tw:items-center tw:gap-2 tw:border-border tw:border-t tw:p-4">
						<input
							ref={inputRef}
							type="text"
							value={draft}
							onChange={(event) => setDraft(event.target.value)}
							placeholder={t("placeholder")}
							aria-label={t("messageLabel")}
							autoFocus
							disabled={disabled}
							className="tw:h-control tw:min-w-0 tw:flex-1 tw:rounded-control tw:border tw:border-input tw:bg-input tw:px-control-padding tw:text-sm tw:outline-none tw:placeholder:text-muted-foreground tw:focus-visible:border-ring tw:focus-visible:ring-2 tw:focus-visible:ring-ring/50 tw:disabled:opacity-50"
						/>
						{snapshot?.actions.includes("stop") || activity === "stopping" ? (
							<button
								type="button"
								onClick={() => void handleCancel()}
								aria-label={activity === "stopping" ? t("stopping") : t("stopGenerating")}
								disabled={activity === "stopping"}
								className="tw:flex tw:size-control tw:shrink-0 tw:items-center tw:justify-center tw:rounded-control tw:bg-primary tw:text-primary-foreground tw:transition-colors tw:hover:bg-primary/90 tw:disabled:opacity-50"
							>
								<StopIcon aria-hidden="true" />
							</button>
						) : (
							<button
								type="submit"
								aria-label={t("send")}
								disabled={disabled || draft.trim().length === 0}
								className="tw:flex tw:size-control tw:shrink-0 tw:items-center tw:justify-center tw:rounded-control tw:bg-primary tw:text-primary-foreground tw:transition-colors tw:hover:bg-primary/90 tw:disabled:opacity-50"
							>
								<SendIcon aria-hidden="true" />
							</button>
						)}
					</form>
				</div>
			)}
			<button
				type="button"
				ref={launcherRef}
				onClick={() => setOpen((prev) => !prev)}
				aria-label={open ? t("closeChat") : t("openChat")}
				aria-expanded={open}
				aria-haspopup="dialog"
				className="tw:flex tw:size-12 tw:items-center tw:justify-center tw:rounded-full tw:bg-primary tw:text-primary-foreground tw:shadow-lg tw:transition-transform tw:hover:scale-105"
			>
				<ChatIcon aria-hidden="true" />
			</button>
		</div>
	)
}

export function EmbeddedWidget({ title, appearance, forcedScheme, isAvailable }: EmbeddedWidgetProps) {
	const resolved = resolveAppearance(appearance)
	const [i18n] = useState(() => createWidgetI18n(resolved.language))

	useEffect(() => {
		void i18n.changeLanguage(resolved.language)
	}, [i18n, resolved.language])

	if (isAvailable === false) return null

	return (
		<I18nextProvider i18n={i18n}>
			<WidgetChat title={title} appearance={resolved} forcedScheme={forcedScheme} />
		</I18nextProvider>
	)
}

export function ConnectedEmbeddedWidget({ client, title, appearance, forcedScheme }: ConnectedEmbeddedWidgetProps) {
	const snapshot = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot)

	useEffect(() => {
		void client.initialize().catch((cause: unknown) => console.warn("TalqoWidget: initialization failed", cause))
		return () => client.dispose()
	}, [client])

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
		/>
	)
}

function ConnectedWidgetContent({
	client,
	snapshot,
	title,
	appearance,
	forcedScheme,
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
				snapshot={snapshot}
				client={client}
			/>
		</I18nextProvider>
	)
}
