import { type CSSProperties, type FormEvent, useEffect, useRef, useState } from "react"
import { I18nextProvider, useTranslation } from "react-i18next"

import { Bubble, BubbleContent, BubbleGroup } from "./components/ui/bubble"
import { createWidgetI18n, isWidgetLanguage, type WidgetLanguage } from "./lib/i18n"
import { cn } from "./lib/utils"

import "./index.css"

export type WidgetTheme = "light" | "dark"

export type EmbeddedWidgetProps = {
	title?: string
	language?: WidgetLanguage
	botId?: string
	theme?: WidgetTheme
	accent?: string
}

type Message = {
	id: number
	from: "assistant" | "user"
	// Seed messages carry an i18n key so they re-translate on language switch;
	// user messages are plain text.
	text?: string
	i18nKey?: string
}

// URL-provided accent is interpolated into a CSS variable; only hex colors are allowed.
function sanitizeAccent(accent: string | undefined): string | undefined {
	return accent && /^#[0-9a-fA-F]{6}$/.test(accent) ? accent : undefined
}

function WidgetChat({
	title,
	theme,
	accent,
	botId,
}: {
	title?: string
	theme?: WidgetTheme
	accent?: string
	botId?: string
}) {
	const { t } = useTranslation()
	const [open, setOpen] = useState(false)
	const [messages, setMessages] = useState<Message[]>([{ id: 1, from: "assistant", i18nKey: "greeting" }])
	const [draft, setDraft] = useState("")
	const nextId = useRef(2)
	const launcherRef = useRef<HTMLButtonElement>(null)
	const wasOpen = useRef(false)

	// Return focus to the launcher after the panel closes.
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
		setMessages((prev) => [...prev, { id: nextId.current++, from: "user", text }])
		setDraft("")
	}

	const accentStyle: CSSProperties | undefined = accent
		? ({ "--talqo-primary": accent, "--talqo-ring": accent } as CSSProperties)
		: undefined

	return (
		<div
			className={cn(
				"talqo-widget tw:flex tw:flex-col tw:items-end tw:gap-3 tw:font-sans tw:text-foreground",
				theme === "dark" && "dark",
				theme === "light" && "light",
			)}
			style={accentStyle}
			data-bot={botId}
		>
			{open && (
				<div
					role="dialog"
					aria-label={title ?? t("defaultTitle")}
					className="tw:flex tw:h-96 tw:w-80 tw:flex-col tw:overflow-hidden tw:rounded-xl tw:border tw:border-border tw:bg-card tw:shadow-lg"
					onKeyDown={(event) => {
						if (event.key === "Escape") {
							setOpen(false)
						}
					}}
				>
					<header className="tw:flex tw:items-center tw:justify-between tw:border-border tw:border-b tw:px-4 tw:py-3">
						<h2 className="tw:font-semibold tw:text-sm">{title ?? t("defaultTitle")}</h2>
						<button
							type="button"
							onClick={() => setOpen(false)}
							aria-label={t("closeChat")}
							className="tw:text-muted-foreground tw:transition-colors tw:hover:text-foreground"
						>
							<svg
								xmlns="http://www.w3.org/2000/svg"
								width="16"
								height="16"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth="2"
								strokeLinecap="round"
								strokeLinejoin="round"
								role="img"
							>
								<title>{t("close")}</title>
								<path d="M18 6 6 18" />
								<path d="m6 6 12 12" />
							</svg>
						</button>
					</header>
					<div className="tw:flex-1 tw:overflow-y-auto tw:p-3" aria-live="polite">
						<BubbleGroup>
							{messages.map((message) => (
								<Bubble
									key={message.id}
									variant={message.from === "user" ? "default" : "muted"}
									align={message.from === "user" ? "end" : "start"}
								>
									<BubbleContent className={cn(message.from === "assistant" && "tw:text-foreground")}>
										{message.i18nKey ? t(message.i18nKey) : message.text}
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
							className="tw:shrink-0 tw:rounded-md tw:bg-primary tw:px-3 tw:py-2 tw:font-medium tw:text-primary-foreground tw:text-sm tw:transition-colors tw:hover:bg-primary/90"
						>
							{t("send")}
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
				<svg
					xmlns="http://www.w3.org/2000/svg"
					width="24"
					height="24"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="2"
					strokeLinecap="round"
					strokeLinejoin="round"
					role="img"
				>
					<title>{t("chatIcon")}</title>
					<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
				</svg>
			</button>
		</div>
	)
}

export const EmbeddedWidget = ({ title, language = "en", botId, theme, accent }: EmbeddedWidgetProps) => {
	const [i18n] = useState(() => createWidgetI18n(isWidgetLanguage(language) ? language : "en"))

	useEffect(() => {
		if (isWidgetLanguage(language)) {
			i18n.changeLanguage(language)
		}
	}, [i18n, language])

	return (
		<I18nextProvider i18n={i18n}>
			<WidgetChat title={title} botId={botId} theme={theme} accent={sanitizeAccent(accent)} />
		</I18nextProvider>
	)
}
