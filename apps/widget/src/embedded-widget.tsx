import { cn } from "@talqo/ui/lib/utils"
import {
	type CSSProperties,
	type FormEvent,
	type KeyboardEvent,
	type PointerEvent as ReactPointerEvent,
	type RefObject,
	useEffect,
	useRef,
	useState,
} from "react"
import { I18nextProvider, useTranslation } from "react-i18next"

import ChatIcon from "./assets/icons/chat.svg?react"
import CloseIcon from "./assets/icons/close.svg?react"
import ResizeGripIcon from "./assets/icons/resize-grip.svg?react"
import SendIcon from "./assets/icons/send.svg?react"
import { Bubble, BubbleContent, BubbleGroup } from "./components/ui/bubble"
import { createWidgetI18n, isWidgetLanguage, type WidgetLanguage } from "./lib/i18n"

import "./index.css"

export type WidgetTheme = "light" | "dark"
export type WidgetPosition = "bottom-right" | "bottom-left"

export type EmbeddedWidgetProps = {
	title?: string
	language?: WidgetLanguage
	embedToken?: string
	theme?: WidgetTheme
	accent?: string
	position?: WidgetPosition
}

const positionClasses: Record<WidgetPosition, string> = {
	"bottom-right": "tw:fixed tw:right-4 tw:bottom-4 tw:items-end",
	"bottom-left": "tw:fixed tw:bottom-4 tw:left-4 tw:items-start",
}

type ResizeEdge = "top" | "side" | "corner"

const DEFAULT_WIDTH = 320
const DEFAULT_HEIGHT = 384
const MIN_WIDTH = 280
const MIN_HEIGHT = 320
const RESIZE_MARGIN = 32
const RESIZE_KEYBOARD_STEP = 16

function clampPanelSize(width: number, height: number): { width: number; height: number } {
	return {
		width: Math.round(Math.min(Math.max(width, MIN_WIDTH), Math.max(MIN_WIDTH, window.innerWidth - RESIZE_MARGIN))),
		height: Math.round(
			Math.min(Math.max(height, MIN_HEIGHT), Math.max(MIN_HEIGHT, window.innerHeight - RESIZE_MARGIN)),
		),
	}
}

type Message = {
	id: number
	from: "assistant" | "user"
	text?: string
	i18nKey?: "greeting"
}

function messageText(message: Message, t: (key: string) => string): string | undefined {
	if (message.i18nKey === "greeting") {
		return t("greeting")
	}
	return message.text
}

function sanitizeAccent(accent: string | undefined): string | undefined {
	return accent && /^#[0-9a-fA-F]{6}$/.test(accent) ? accent : undefined
}

const HEX_RADIX = 16
const RED_START = 1
const RED_END = 3
const GREEN_START = 3
const GREEN_END = 5
const BLUE_START = 5
const BLUE_END = 7
const RED_LUMINANCE_WEIGHT = 0.299
const GREEN_LUMINANCE_WEIGHT = 0.587
const BLUE_LUMINANCE_WEIGHT = 0.114
const MAX_COLOR_CHANNEL = 255
const LIGHT_ACCENT_THRESHOLD = 0.6

// Derive a contrast-safe foreground from the accent's luminance; a light accent
// needs dark text rather than the default white --talqo-primary-foreground.
function accentForeground(accent: string | undefined): string | undefined {
	if (!accent) {
		return undefined
	}
	const r = Number.parseInt(accent.slice(RED_START, RED_END), HEX_RADIX)
	const g = Number.parseInt(accent.slice(GREEN_START, GREEN_END), HEX_RADIX)
	const b = Number.parseInt(accent.slice(BLUE_START, BLUE_END), HEX_RADIX)
	const luminance =
		(RED_LUMINANCE_WEIGHT * r + GREEN_LUMINANCE_WEIGHT * g + BLUE_LUMINANCE_WEIGHT * b) / MAX_COLOR_CHANNEL
	return luminance > LIGHT_ACCENT_THRESHOLD ? "#1a2e23" : "#ffffff"
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

function useResizablePanel(
	open: boolean,
	position: WidgetPosition | undefined,
	panelRef: RefObject<HTMLDivElement | null>,
) {
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

	// Reset the custom size when the chat closes; render-time reset avoids an extra render pass.
	const [prevOpen, setPrevOpen] = useState(open)
	if (prevOpen !== open) {
		setPrevOpen(open)
		if (!open) {
			setSize(null)
		}
	}

	// Which edge is mid-drag; used to keep its highlight visible while resizing.
	const [activeEdge, setActiveEdge] = useState<ResizeEdge | null>(null)

	function startResize(edge: ResizeEdge, event: ReactPointerEvent<HTMLDivElement>) {
		if (event.pointerType === "touch" || !panelRef.current) {
			return
		}
		event.preventDefault()
		setActiveEdge(edge)
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
			setSize(clampPanelSize(edge === "top" ? anchor.width : rawWidth, edge === "side" ? anchor.height : rawHeight))
		}
		function handleEnd(endEvent: PointerEvent) {
			if (endEvent.pointerId !== pointerId) {
				return
			}
			setActiveEdge(null)
			window.removeEventListener("pointermove", handleMove)
			window.removeEventListener("pointerup", handleEnd)
			window.removeEventListener("pointercancel", handleEnd)
		}
		window.addEventListener("pointermove", handleMove)
		window.addEventListener("pointerup", handleEnd)
		window.addEventListener("pointercancel", handleEnd)
	}

	function resizeByKeys(edge: ResizeEdge, event: KeyboardEvent<HTMLDivElement>) {
		const current = size ?? { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT }
		const vertical = edge !== "side" && (event.key === "ArrowUp" || event.key === "ArrowDown")
		const horizontal = edge !== "top" && (event.key === "ArrowLeft" || event.key === "ArrowRight")
		if (!(vertical || horizontal)) {
			return
		}
		event.preventDefault()
		const growsUp = event.key === "ArrowUp"
		// With a right anchor, dragging left grows the panel; with a left anchor, dragging right grows it.
		const growsSideways = position === "bottom-left" ? event.key === "ArrowRight" : event.key === "ArrowLeft"
		setSize(
			clampPanelSize(
				current.width + (horizontal ? (growsSideways ? RESIZE_KEYBOARD_STEP : -RESIZE_KEYBOARD_STEP) : 0),
				current.height + (vertical ? (growsUp ? RESIZE_KEYBOARD_STEP : -RESIZE_KEYBOARD_STEP) : 0),
			),
		)
	}

	return { size, resizable, startResize, resizeByKeys, activeEdge }
}

function WidgetChat({
	title,
	theme,
	accent,
	embedToken,
	position,
}: {
	title?: string
	theme?: WidgetTheme
	accent?: string
	embedToken?: string
	position?: WidgetPosition
}) {
	const { t } = useTranslation()
	const [open, setOpen] = useState(false)
	const [messages, setMessages] = useState<Message[]>([{ id: 1, from: "assistant", i18nKey: "greeting" }])
	const [draft, setDraft] = useState("")
	const launcherRef = useRef<HTMLButtonElement>(null)
	const panelRef = useRef<HTMLDivElement>(null)
	const wasOpen = useRef(false)
	const { size, resizable, startResize, resizeByKeys, activeEdge } = useResizablePanel(open, position, panelRef)

	useEffect(() => {
		if (wasOpen.current && !open) {
			launcherRef.current?.focus()
		}
		wasOpen.current = open
	}, [open])

	function handleSend(event: FormEvent<HTMLFormElement>) {
		event.preventDefault()
		const text = draft.trim()
		if (!text) {
			return
		}
		setMessages((prev) => [...prev, { id: (prev.at(-1)?.id ?? 0) + 1, from: "user", text }])
		setDraft("")
	}

	const panelStyle: CSSProperties = size ? { width: size.width, height: size.height } : {}

	const accentStyle: CSSProperties | undefined = accent
		? ({
				"--talqo-primary": accent,
				"--talqo-primary-foreground": accentForeground(accent),
				"--talqo-ring": accent,
			} as CSSProperties)
		: undefined

	return (
		<div
			className={cn(
				"talqo-widget tw:flex tw:flex-col tw:gap-3 tw:font-sans tw:text-foreground",
				position ? positionClasses[position] : "tw:items-end",
				theme === "dark" && "dark",
				theme === "light" && "light",
			)}
			style={accentStyle}
			data-embed-token={embedToken}
		>
			{open && (
				<div
					role="dialog"
					aria-label={title ?? t("defaultTitle")}
					ref={panelRef}
					className="tw:group tw:relative tw:flex tw:h-96 tw:w-80 tw:max-w-[calc(100vw-2rem)] tw:flex-col tw:overflow-hidden tw:rounded-xl tw:border tw:border-border tw:bg-card tw:shadow-lg"
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
						<>
							<div
								role="separator"
								tabIndex={0}
								aria-label={t("resizeHeight")}
								aria-orientation="horizontal"
								data-testid="resize-top"
								className={cn(
									"tw:absolute tw:-top-1.5 tw:right-3 tw:left-3 tw:z-10 tw:h-3 tw:cursor-ns-resize",
									position !== "bottom-left" && "tw:right-14",
									position === "bottom-left" && "tw:left-14",
								)}
								onPointerDown={(event) => startResize("top", event)}
								onKeyDown={(event) => resizeByKeys("top", event)}
							>
								<div
									className={cn(
										"tw:mx-auto tw:mt-1 tw:h-0.5 tw:w-10 tw:rounded-full tw:transition-colors",
										activeEdge === "top" ? "tw:bg-primary" : "tw:bg-border tw:group-hover:bg-muted-foreground/60",
									)}
								/>
							</div>
							<div
								role="separator"
								tabIndex={0}
								aria-label={t("resizeWidth")}
								aria-orientation="vertical"
								data-testid="resize-side"
								className={cn(
									"tw:absolute tw:top-3 tw:bottom-3 tw:z-10 tw:w-3",
									position === "bottom-left" ? "tw:-right-1.5 tw:cursor-ew-resize" : "tw:-left-1.5 tw:cursor-ew-resize",
								)}
								onPointerDown={(event) => startResize("side", event)}
								onKeyDown={(event) => resizeByKeys("side", event)}
							>
								<div
									className={cn(
										"tw:my-auto tw:h-10 tw:w-0.5 tw:rounded-full tw:transition-colors",
										position === "bottom-left" ? "tw:mr-1 tw:ml-auto" : "tw:mt-auto tw:ml-1",
										activeEdge === "side" ? "tw:bg-primary" : "tw:bg-border tw:group-hover:bg-muted-foreground/60",
									)}
								/>
							</div>
							<div
								role="separator"
								tabIndex={0}
								aria-label={t("resizeWindow")}
								data-testid="resize-corner"
								className={cn(
									"tw:absolute tw:z-10 tw:size-5 tw:transition-colors",
									position === "bottom-left"
										? "tw:-top-1.5 tw:-right-1.5 tw:cursor-nesw-resize"
										: "tw:-top-1.5 tw:-left-1.5 tw:cursor-nwse-resize",
								)}
								onPointerDown={(event) => startResize("corner", event)}
								onKeyDown={(event) => resizeByKeys("corner", event)}
							>
								{/* Diagonal grip lines hinting the panel can be stretched. */}
								<ResizeGripIcon
									aria-hidden="true"
									className={cn(
										"tw:size-full tw:transition-colors",
										position === "bottom-left" && "tw:-scale-x-100",
										activeEdge === "corner" ? "tw:text-primary" : "tw:text-muted-foreground",
									)}
								/>
							</div>
						</>
					)}
					<header className="tw:flex tw:items-center tw:justify-between tw:border-border tw:border-b tw:px-4 tw:py-3">
						<h2 className="tw:font-semibold tw:text-sm">{title ?? t("defaultTitle")}</h2>
						<button
							type="button"
							onClick={() => setOpen(false)}
							aria-label={t("closeChat")}
							className="tw:text-muted-foreground tw:transition-colors tw:hover:text-foreground"
						>
							<CloseIcon aria-hidden="true" />
						</button>
					</header>
					<div className="tw:flex-1 tw:overflow-y-auto tw:p-3" aria-live="polite">
						<BubbleGroup>
							{messages.map((message) => (
								<Bubble key={message.id} align={message.from === "user" ? "end" : "start"}>
									<BubbleContent
										variant={message.from === "user" ? "default" : "muted"}
										className={cn(message.from === "assistant" && "tw:text-foreground")}
									>
										{messageText(message, t)}
									</BubbleContent>
								</Bubble>
							))}
						</BubbleGroup>
					</div>
					<form onSubmit={handleSend} className="tw:flex tw:items-center tw:gap-2 tw:border-border tw:border-t tw:p-3">
						<input
							type="text"
							value={draft}
							onChange={(event) => setDraft(event.target.value)}
							placeholder={t("placeholder")}
							aria-label={t("messageLabel")}
							autoFocus
							className="tw:min-w-0 tw:flex-1 tw:rounded-md tw:border tw:border-input tw:bg-background tw:px-3 tw:py-2 tw:text-sm tw:outline-none tw:placeholder:text-muted-foreground tw:focus-visible:border-ring tw:focus-visible:ring-2 tw:focus-visible:ring-ring/50"
						/>
						<button
							type="submit"
							aria-label={t("send")}
							className="tw:shrink-0 tw:rounded-md tw:bg-primary tw:p-2 tw:text-primary-foreground tw:transition-colors tw:hover:bg-primary/90"
						>
							<SendIcon aria-hidden="true" />
						</button>
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

export function EmbeddedWidget({ title, language = "en", embedToken, theme, accent, position }: EmbeddedWidgetProps) {
	const [i18n] = useState(() => createWidgetI18n(isWidgetLanguage(language) ? language : "en"))

	useEffect(() => {
		if (isWidgetLanguage(language)) {
			i18n.changeLanguage(language)
		}
	}, [i18n, language])

	return (
		<I18nextProvider i18n={i18n}>
			<WidgetChat
				title={title}
				embedToken={embedToken}
				theme={theme}
				accent={sanitizeAccent(accent)}
				position={position}
			/>
		</I18nextProvider>
	)
}
