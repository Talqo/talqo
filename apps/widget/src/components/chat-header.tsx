import CloseIcon from "@/assets/icons/close.svg?react"
import MoonIcon from "@/assets/icons/moon.svg?react"
import NewChatIcon from "@/assets/icons/new-chat.svg?react"
import SunIcon from "@/assets/icons/sun.svg?react"
import { useTranslation } from "react-i18next"

const headerControlClasses =
	"tw:flex tw:size-10 tw:items-center tw:justify-center tw:rounded-control tw:text-muted-foreground tw:transition-colors tw:hover:text-foreground tw:focus-visible:ring-2 tw:focus-visible:ring-ring/50 tw:focus-visible:outline-none tw:sm:size-8"

type ChatHeaderProps = {
	title?: string
	scheme: "light" | "dark"
	hasMessages: boolean
	canStartNewChat: boolean
	showThemeToggle: boolean
	onClose: () => void
	onNewChat: () => void
	onToggleScheme: () => void
}

export function ChatHeader({
	title,
	scheme,
	hasMessages,
	canStartNewChat,
	showThemeToggle,
	onClose,
	onNewChat,
	onToggleScheme,
}: ChatHeaderProps) {
	const { t } = useTranslation()
	const isDark = scheme === "dark"

	return (
		<header className="tw:flex tw:items-center tw:justify-between tw:border-border tw:border-b tw:px-4 tw:py-3.5">
			<h2 className="tw:font-semibold tw:text-sm">{title ?? t("defaultTitle")}</h2>
			<div className="tw:flex tw:items-center tw:gap-1">
				{hasMessages && (
					<button
						type="button"
						onClick={onNewChat}
						disabled={!canStartNewChat}
						aria-label={t("newChat")}
						title={t("newChatTooltip")}
						className={`${headerControlClasses} tw:mr-1 tw:disabled:opacity-50`}
					>
						<NewChatIcon aria-hidden="true" />
					</button>
				)}
				{showThemeToggle && (
					<button
						type="button"
						onClick={onToggleScheme}
						aria-label={isDark ? t("switchToLight") : t("switchToDark")}
						className={headerControlClasses}
					>
						{isDark ? <SunIcon aria-hidden="true" /> : <MoonIcon aria-hidden="true" />}
					</button>
				)}
				<button type="button" onClick={onClose} aria-label={t("closeChat")} className={headerControlClasses}>
					<CloseIcon aria-hidden="true" />
				</button>
			</div>
		</header>
	)
}
