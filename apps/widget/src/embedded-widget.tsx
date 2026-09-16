import type { ChatClient, ChatError, ChatMessage, ChatSnapshot } from "@talqo/sdk"

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
import { cn } from "@talqo/ui/lib/utils"
import {
	type CSSProperties,
	type FormEvent,
	type KeyboardEvent,
	type PointerEvent as ReactPointerEvent,
	type RefObject,
	useCallback,
	useEffect,
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
import { Bubble, BubbleContent, BubbleGroup } from "./components/ui/bubble"
import { mergeAppearance } from "./lib/embed-config"
import { createWidgetI18n, isWidgetLanguage } from "./lib/i18n"

import "./index.css"

export type EmbeddedWidgetProps = {
	title?: string
	appearance?: WidgetAppearanceInput
	/** Held invisible (but laid out) until the fetched configuration settles. */
	hidden?: boolean
	/** Preview-only: pins the scheme to whichever tab the operator is editing. */
	forcedScheme?: ColorScheme
	unavailable?: boolean
}

export type ConnectedEmbeddedWidgetProps = EmbeddedWidgetProps & {
	client: ChatClient
}

type ColorScheme = "light" | "dark"

const DARK_SCHEME_QUERY = "(prefers-color-scheme: dark)"

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

const MIN_WIDTH = 280
const MIN_HEIGHT = 320
// Horizontal margin keeps the panel off the screen sides.
const RESIZE_MARGIN = 32
// Vertical budget excludes the launcher row below the panel (16px offset + 12px gap
// + 48px launcher) plus a 16px top clearance, so the panel can never grow past the
// top of the screen.
const RESIZE_HEIGHT_MARGIN = 92

function clampPanelSize(width: number, height: number): { width: number; height: number } {
	return {
		width: Math.round(Math.min(Math.max(width, MIN_WIDTH), Math.max(MIN_WIDTH, window.innerWidth - RESIZE_MARGIN))),
		height: Math.round(
			Math.min(Math.max(height, MIN_HEIGHT), Math.max(MIN_HEIGHT, window.innerHeight - RESIZE_HEIGHT_MARGIN)),
		),
	}
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

function useResizablePanel(position: WidgetPosition | undefined, panelRef: RefObject<HTMLDivElement | null>) {
	const [size, setSize] = useState<{ width: number; height: number } | null>(null)
	// Free resize is desktop-only; mobile keeps the default panel size.
	const [resizable, setResizable] = useState(
		() => typeof window !== "undefined" && window.matchMedia("(min-width: 640px) and (pointer: fine)").matches,
	)

	useEffect(() => {
		const query = window.matchMedia("(min-width: 640px) and (pointer: fine)")
		const onChange = (event: MediaQueryListEvent) => {
			setResizable(event.matches)
			if (!event.matches) {
				setSize(null)
			}
		}
		query.addEventListener("change", onChange)
		return () => query.removeEventListener("change", onChange)
	}, [])

	// Grip highlight stays on while a drag is in flight.
	const [resizing, setResizing] = useState(false)

	function startResize(event: ReactPointerEvent<HTMLDivElement>) {
		if (event.pointerType === "touch" || !panelRef.current) {
			return
		}
		event.preventDefault()
		setResizing(true)
		const anchor = panelRef.current.getBoundingClientRect()
		// The panel's bottom screen edge stays pinned: for bottom-right (default)
		// it is the right edge, for bottom-left the left edge.
		const side = position === "bottom-left" ? "left" : "right"
		const anchorX = side === "right" ? anchor.right : anchor.left
		const anchorBottom = anchor.bottom
		const pointerId = event.pointerId

		function handleMove(moveEvent: PointerEvent) {
			if (moveEvent.pointerId !== pointerId) {
				return
			}
			const rawWidth = side === "right" ? anchorX - moveEvent.clientX : moveEvent.clientX - anchorX
			const rawHeight = anchorBottom - moveEvent.clientY
			setSize(clampPanelSize(rawWidth, rawHeight))
		}
		function handleEnd(endEvent: PointerEvent) {
			if (endEvent.pointerId !== pointerId) {
				return
			}
			setResizing(false)
			window.removeEventListener("pointermove", handleMove)
			window.removeEventListener("pointerup", handleEnd)
			window.removeEventListener("pointercancel", handleEnd)
		}
		window.addEventListener("pointermove", handleMove)
		window.addEventListener("pointerup", handleEnd)
		window.addEventListener("pointercancel", handleEnd)
	}

	return { size, resizable, startResize, resizing }
}

type ChatPresentation = {
	snapshot?: ChatSnapshot
	client?: ChatClient
	unavailable?: boolean
}

const EMPTY_MESSAGES: readonly ChatMessage[] = []

function errorText(error: ChatError, t: (key: string, options?: Record<string, unknown>) => string): string {
	switch (error.code) {
		case "invalid-request":
			return t("errorInvalidRequest")
		case "malformed-json":
			return t("errorMalformedJson")
		case "chat-client-address-unavailable":
			return t("errorClientAddressUnavailable")
		case "chat-conversation-too-long":
			return t("errorConversationTooLong")
		case "chat-daily-allowance-exceeded":
			return t("errorDailyAllowance", {
				reset: error.retryAt ? new Date(error.retryAt).toLocaleString() : t("nextUtcDay"),
			})
		case "chat-concurrency-limit":
			return t("errorConcurrencyLimit")
		case "chat-session-busy":
			return t("errorSessionBusy")
		case "chat-request-conflict":
			return t("errorRequestConflict")
		case "chat-session-unauthorized":
			return t("errorSessionUnauthorized")
		case "chat-context-limit":
			return t("errorContextLimit")
		case "chat-input-incompatible":
			return t("errorInputIncompatible")
		case "payload-too-large":
			return t("errorPayloadTooLarge")
		case "provider-error":
			return t("errorProvider")
		case "internal-server-error":
			return t("errorInternalServer")
		case "embed-not-found":
			return t("errorEmbedNotFound")
		case "request-failed":
			return t("errorRequestFailed")
		case "invalid-response":
			return t("errorInvalidResponse")
		case "transport-error":
			return t("errorTransport")
		case "storage-unavailable":
			return t("errorStorageUnavailable")
		case "cancel-failed":
			return t("errorCancelFailed")
		case "reset-failed":
			return t("errorResetFailed")
	}
}

function errorAllowsNewChat(error: ChatError): boolean {
	if (error.newChatAvailable !== undefined) return error.newChatAvailable
	switch (error.code) {
		case "chat-conversation-too-long":
		case "chat-context-limit":
		case "chat-session-unauthorized":
			return true
		case "invalid-request":
		case "malformed-json":
		case "chat-client-address-unavailable":
		case "chat-daily-allowance-exceeded":
		case "chat-concurrency-limit":
		case "chat-session-busy":
		case "chat-request-conflict":
		case "chat-input-incompatible":
		case "payload-too-large":
		case "provider-error":
		case "internal-server-error":
		case "embed-not-found":
		case "request-failed":
		case "invalid-response":
		case "transport-error":
		case "storage-unavailable":
		case "cancel-failed":
		case "reset-failed":
			return false
	}
}

function outcomeText(outcome: ChatMessage["outcome"], t: (key: string) => string): string | undefined {
	switch (outcome) {
		case "failed":
			return t("outcomeFailed")
		case "cancelled":
			return t("outcomeCancelled")
		case "blocked":
			return t("outcomeBlocked")
		case "interrupted":
			return t("outcomeInterrupted")
		default:
			return undefined
	}
}

function WidgetChat({
	title,
	appearance,
	hidden,
	forcedScheme,
	snapshot,
	client,
	unavailable,
}: {
	title?: string
	appearance: WidgetAppearance
	hidden?: boolean
	forcedScheme?: ColorScheme
} & ChatPresentation) {
	const { t } = useTranslation()
	const [open, setOpen] = useState(false)
	const [draft, setDraft] = useState("")
	const [submitting, setSubmitting] = useState(false)
	const [visitorScheme, setVisitorScheme] = useState<ColorScheme | null>(null)
	const launcherRef = useRef<HTMLButtonElement>(null)
	const panelRef = useRef<HTMLDivElement>(null)
	const inputRef = useRef<HTMLInputElement>(null)
	const draftRef = useRef("")
	const pendingSend = useRef<{ originalDraft: string; text: string; messageIds: Set<string> } | undefined>(undefined)
	const wasOpen = useRef(false)
	const prefersDark = usePrefersDark()
	const position = appearance.position
	const { size, resizable, startResize, resizing } = useResizablePanel(position, panelRef)
	const messages = snapshot?.messages ?? EMPTY_MESSAGES
	const initialization = snapshot?.initialization ?? (unavailable ? "error" : "ready")
	const generation = snapshot?.generation ?? "idle"
	const resetting = snapshot?.reset === "resetting"
	const activeGeneration = generation !== "idle"
	const unusable = unavailable || initialization === "error"
	const disabled = unusable || initialization !== "ready" || resetting || activeGeneration || submitting
	const visibleError = unavailable ? ({ code: "embed-not-found" } satisfies ChatError) : snapshot?.error
	const canStartNewChat =
		client !== undefined &&
		!resetting &&
		(initialization === "ready" ||
			(initialization === "error" &&
				snapshot?.configuration !== undefined &&
				visibleError !== undefined &&
				errorAllowsNewChat(visibleError)))

	useEffect(() => {
		draftRef.current = draft
	}, [draft])

	useEffect(() => {
		const pending = pendingSend.current
		if (!pending) return
		const accepted = messages.some(
			(message) =>
				!pending.messageIds.has(message.id) &&
				message.role === "user" &&
				message.text === pending.text &&
				message.outcome === "completed",
		)
		if (!accepted) return
		pendingSend.current = undefined
		if (draftRef.current === pending.originalDraft) setDraft("")
	}, [messages])

	useEffect(() => {
		if (wasOpen.current && !open) {
			launcherRef.current?.focus()
		}
		wasOpen.current = open
	}, [open])

	// Visitor choice (FR-2.21) beats the operator default, which beats the host's preference.
	// `forcedScheme` is preview-only and pins whichever tab the operator is editing.
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
		pendingSend.current = { originalDraft: draft, text, messageIds: new Set(messages.map(({ id }) => id)) }
		setSubmitting(true)
		try {
			await client.sendMessage(text)
		} catch {
			pendingSend.current = undefined
		} finally {
			setSubmitting(false)
		}
	}

	async function handleNewChat() {
		if (!canStartNewChat) return
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

	const paletteStyle = {
		"--talqo-primary-input": active.primary,
		"--talqo-text-on-primary-input": active.textOnPrimary,
		"--talqo-background-input": active.background,
		"--talqo-surface-input": active.surface,
		"--talqo-text-input": active.text,
		// visibility, not display: nothing shifts when the fetched configuration paints.
		...(hidden && { visibility: "hidden" }),
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
						// Only the corner grip: it resizes width and height in one drag and
						// never collides with the header like the edge handles did.
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
							{/* Diagonal grip lines hinting the panel can be stretched. */}
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
					<div className="tw:flex-1 tw:overflow-y-auto tw:p-4" aria-live="polite">
						<BubbleGroup>
							{messages.length === 0 && initialization === "ready" && !unusable && (
								<Bubble align="start">
									<BubbleContent variant="muted" className="tw:text-foreground">
										{t("greeting")}
									</BubbleContent>
								</Bubble>
							)}
							{messages.map((message) => (
								<Bubble key={message.id} align={message.role === "user" ? "end" : "start"}>
									<BubbleContent
										variant={message.role === "user" ? "default" : "muted"}
										className={cn(message.role === "assistant" && "tw:text-foreground")}
									>
										{message.text}
									</BubbleContent>
									{outcomeText(message.outcome, t) && (
										<span className="tw:px-1 tw:text-muted-foreground tw:text-xs">
											{outcomeText(message.outcome, t)}
										</span>
									)}
								</Bubble>
							))}
							{initialization === "loading" && (
								<p className="tw:text-muted-foreground tw:text-sm">{t("initializing")}</p>
							)}
							{snapshot?.recovery === "pending" && (
								<p className="tw:text-muted-foreground tw:text-sm">{t("recovering")}</p>
							)}
							{snapshot?.recovery === "unavailable" && (
								<p role="alert" className="tw:text-destructive tw:text-sm">
									{t("recoveryUnavailable")}
								</p>
							)}
							{snapshot?.persistence === "memory" && snapshot.error?.code !== "storage-unavailable" && (
								<p role="status" className="tw:text-muted-foreground tw:text-sm">
									{t("errorStorageUnavailable")}
								</p>
							)}
							{visibleError && (
								<div
									role="alert"
									className="tw:flex tw:flex-col tw:items-start tw:gap-2 tw:rounded-surface tw:bg-muted tw:p-3 tw:text-sm"
								>
									<p>{errorText(visibleError, t)}</p>
									{visibleError.code === "chat-daily-allowance-exceeded" &&
										(visibleError.retryAt ?? snapshot?.retryAt) && (
											<time dateTime={visibleError.retryAt ?? snapshot?.retryAt}>
												{t("allowanceReset", {
													reset: new Date((visibleError.retryAt ?? snapshot?.retryAt)!).toLocaleString(),
												})}
											</time>
										)}
									{errorAllowsNewChat(visibleError) && (
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
							className="tw:h-control tw:min-w-0 tw:flex-1 tw:rounded-control tw:border tw:border-input tw:bg-input tw:px-control-padding tw:text-sm tw:outline-none tw:placeholder:text-muted-foreground tw:focus-visible:border-ring tw:focus-visible:ring-2 tw:focus-visible:ring-ring/50"
						/>
						{activeGeneration ? (
							<button
								type="button"
								onClick={() => void handleCancel()}
								aria-label={generation === "cancelling" ? t("stopping") : t("stopGenerating")}
								disabled={generation === "cancelling"}
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

export function EmbeddedWidget({ title, appearance, hidden, forcedScheme, unavailable }: EmbeddedWidgetProps) {
	const resolved = resolveAppearance(appearance)
	const [i18n] = useState(() => createWidgetI18n(resolved.language))

	useEffect(() => {
		i18n.changeLanguage(resolved.language)
	}, [i18n, resolved.language])

	return (
		<I18nextProvider i18n={i18n}>
			<WidgetChat
				title={title}
				appearance={resolved}
				hidden={hidden}
				forcedScheme={forcedScheme}
				unavailable={unavailable}
			/>
		</I18nextProvider>
	)
}

export function ConnectedEmbeddedWidget({
	client,
	title,
	appearance,
	hidden,
	forcedScheme,
}: ConnectedEmbeddedWidgetProps) {
	const snapshot = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot)
	const [initializationFailed, setInitializationFailed] = useState(false)
	const configuredAppearance = (snapshot.configuration?.appearance ?? {}) as WidgetAppearanceInput
	const resolved = resolveAppearance(mergeAppearance(configuredAppearance, appearance ?? {}))
	const [i18n] = useState(() => createWidgetI18n(resolved.language))

	useEffect(() => {
		void client.initialize().catch(() => setInitializationFailed(true))
		return () => client.dispose()
	}, [client])

	useEffect(() => {
		i18n.changeLanguage(resolved.language)
	}, [i18n, resolved.language])

	return (
		<I18nextProvider i18n={i18n}>
			<WidgetChat
				title={title ?? snapshot.configuration?.title}
				appearance={resolved}
				hidden={
					hidden ||
					(snapshot.configuration === undefined && !initializationFailed && snapshot.initialization !== "error")
				}
				forcedScheme={forcedScheme}
				snapshot={snapshot}
				client={client}
				unavailable={
					initializationFailed && snapshot.initialization !== "error" && snapshot.configuration === undefined
				}
			/>
		</I18nextProvider>
	)
}
