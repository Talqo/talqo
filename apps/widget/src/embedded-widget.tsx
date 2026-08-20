import {
	DEFAULT_WIDGET_APPEARANCE,
	isDarkColor,
	isHexColor,
	isWidgetPosition,
	isWidgetTheme,
	type WidgetAppearance,
	type WidgetAppearanceInput,
	type WidgetPosition,
} from "@talqo/shared/widget-appearance"
import { cn } from "@talqo/ui/lib/utils"
import { type CSSProperties, type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from "react"
import { I18nextProvider, useTranslation } from "react-i18next"

import ChatIcon from "./assets/icons/chat.svg?react"
import CloseIcon from "./assets/icons/close.svg?react"
import MoonIcon from "./assets/icons/moon.svg?react"
import SendIcon from "./assets/icons/send.svg?react"
import SunIcon from "./assets/icons/sun.svg?react"
import { Bubble, BubbleContent, BubbleGroup } from "./components/ui/bubble"
import { createWidgetI18n, isWidgetLanguage } from "./lib/i18n"
import { usePrefersDark } from "./lib/use-prefers-dark"

import "./index.css"

export type EmbeddedWidgetProps = {
	title?: string
	agentId?: string
	appearance?: WidgetAppearanceInput
	/** Held invisible (but laid out) until the fetched configuration settles. */
	hidden?: boolean
}

type ColorScheme = "light" | "dark"

const positionClasses: Record<WidgetPosition, string> = {
	"bottom-right": "tw:fixed tw:right-4 tw:bottom-4 tw:items-end",
	"bottom-left": "tw:fixed tw:bottom-4 tw:left-4 tw:items-start",
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

/**
 * Drops anything that would not survive as a CSS custom property or a known enum.
 * A bad value must fall back per field: an invalid hex written into a var() makes
 * every declaration referencing it invalid at computed-value time, which blanks the
 * whole widget instead of degrading one color.
 */
function resolveAppearance(appearance: WidgetAppearanceInput | undefined): WidgetAppearance {
	return {
		primary: isHexColor(appearance?.primary) ? appearance.primary : DEFAULT_WIDGET_APPEARANCE.primary,
		primaryForeground: isHexColor(appearance?.primaryForeground)
			? appearance.primaryForeground
			: DEFAULT_WIDGET_APPEARANCE.primaryForeground,
		background: isHexColor(appearance?.background) ? appearance.background : DEFAULT_WIDGET_APPEARANCE.background,
		foreground: isHexColor(appearance?.foreground) ? appearance.foreground : DEFAULT_WIDGET_APPEARANCE.foreground,
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

function WidgetChat({
	title,
	agentId,
	appearance,
	hidden,
}: {
	title?: string
	agentId?: string
	appearance: WidgetAppearance
	hidden?: boolean
}) {
	const { t } = useTranslation()
	const [open, setOpen] = useState(false)
	const [messages, setMessages] = useState<Message[]>([{ id: 1, from: "assistant", i18nKey: "greeting" }])
	const [draft, setDraft] = useState("")
	const [visitorScheme, setVisitorScheme] = useState<ColorScheme | null>(null)
	const launcherRef = useRef<HTMLButtonElement>(null)
	const panelRef = useRef<HTMLDivElement>(null)
	const wasOpen = useRef(false)
	const prefersDark = usePrefersDark()

	useEffect(() => {
		if (wasOpen.current && !open) {
			launcherRef.current?.focus()
		}
		wasOpen.current = open
	}, [open])

	// The visitor's own choice (FR-2.21) wins over the operator default, which in turn
	// wins over the host's system preference.
	const operatorScheme: ColorScheme =
		appearance.theme === "system" ? (prefersDark ? "dark" : "light") : appearance.theme
	const scheme = visitorScheme ?? operatorScheme

	// The operator supplies one palette. Its own background tells us which scheme it
	// expresses; the opposite scheme swaps the surface pair and re-derives everything.
	const paletteScheme: ColorScheme = isDarkColor(appearance.background) ? "dark" : "light"

	function handleSend(event: FormEvent<HTMLFormElement>) {
		event.preventDefault()
		const text = draft.trim()
		if (!text) {
			return
		}
		setMessages((prev) => [...prev, { id: (prev.at(-1)?.id ?? 0) + 1, from: "user", text }])
		setDraft("")
	}

	const paletteStyle = {
		"--talqo-primary-input": appearance.primary,
		"--talqo-primary-foreground-input": appearance.primaryForeground,
		"--talqo-background-input": appearance.background,
		"--talqo-foreground-input": appearance.foreground,
		// visibility, not display: layout stays stable, so nothing shifts when it paints.
		...(hidden && { visibility: "hidden" }),
	} as CSSProperties

	return (
		<div
			className={cn(
				"talqo-widget tw:flex tw:flex-col tw:gap-3 tw:font-sans tw:text-foreground",
				positionClasses[appearance.position],
				scheme === "dark" && "dark",
				scheme !== paletteScheme && "talqo-invert",
			)}
			style={paletteStyle}
			data-agent={agentId}
			data-scheme={scheme}
		>
			{open && (
				<div
					role="dialog"
					aria-label={title ?? t("defaultTitle")}
					ref={panelRef}
					className="tw:flex tw:h-96 tw:w-80 tw:max-w-[calc(100vw-2rem)] tw:flex-col tw:overflow-hidden tw:rounded-xl tw:border tw:border-border tw:bg-card tw:shadow-lg"
					onKeyDown={(event) => {
						if (event.key === "Escape") {
							setOpen(false)
						} else {
							trapFocus(event, panelRef.current)
						}
					}}
				>
					<header className="tw:flex tw:items-center tw:justify-between tw:border-border tw:border-b tw:px-4 tw:py-3">
						<h2 className="tw:font-semibold tw:text-sm">{title ?? t("defaultTitle")}</h2>
						<div className="tw:flex tw:items-center tw:gap-1">
							{appearance.themeToggle && (
								<button
									type="button"
									onClick={() => setVisitorScheme(scheme === "dark" ? "light" : "dark")}
									aria-label={scheme === "dark" ? t("switchToLight") : t("switchToDark")}
									className="tw:text-muted-foreground tw:transition-colors tw:hover:text-foreground"
								>
									{scheme === "dark" ? <SunIcon aria-hidden="true" /> : <MoonIcon aria-hidden="true" />}
								</button>
							)}
							<button
								type="button"
								onClick={() => setOpen(false)}
								aria-label={t("closeChat")}
								className="tw:text-muted-foreground tw:transition-colors tw:hover:text-foreground"
							>
								<CloseIcon aria-hidden="true" />
							</button>
						</div>
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

export function EmbeddedWidget({ title, agentId, appearance, hidden }: EmbeddedWidgetProps) {
	const resolved = resolveAppearance(appearance)
	const [i18n] = useState(() => createWidgetI18n(resolved.language))

	useEffect(() => {
		i18n.changeLanguage(resolved.language)
	}, [i18n, resolved.language])

	return (
		<I18nextProvider i18n={i18n}>
			<WidgetChat title={title} agentId={agentId} appearance={resolved} hidden={hidden} />
		</I18nextProvider>
	)
}
