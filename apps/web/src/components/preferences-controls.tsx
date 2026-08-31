import { dashboardLanguages, isDashboardLanguage } from "@/lib/languages"
import { useLanguage } from "@/lib/use-language"
import { useTheme } from "@/lib/use-theme"
import { Button } from "@talqo/ui/components/button"
import { Select, SelectContent, SelectItem, SelectTrigger } from "@talqo/ui/components/select"
import { Languages, Moon, Sun } from "lucide-react"
import { useTranslation } from "react-i18next"

export function ThemeToggle() {
	const { t } = useTranslation()
	const { theme, toggleTheme } = useTheme()
	return (
		<Button
			variant="ghost"
			size="icon"
			onClick={toggleTheme}
			aria-label={theme === "dark" ? t("header.toLightTheme") : t("header.toDarkTheme")}
		>
			{theme === "dark" ? <Sun className="size-5" /> : <Moon className="size-5" />}
		</Button>
	)
}

export function LanguageSelect() {
	const { t } = useTranslation()
	const { language, setLanguage } = useLanguage()
	return (
		<Select
			value={language}
			onValueChange={(value) => {
				if (isDashboardLanguage(value)) {
					setLanguage(value)
				}
			}}
		>
			<SelectTrigger
				className="hover:bg-muted w-auto justify-center gap-1.5 border-0 px-3.5 [&>svg:last-child]:hidden"
				aria-label={`${t("header.language")}: ${dashboardLanguages[language]}`}
			>
				<Languages className="size-4" aria-hidden />
				<span>{language.toUpperCase()}</span>
			</SelectTrigger>
			<SelectContent align="end">
				{Object.entries(dashboardLanguages).map(([value, label]) => (
					<SelectItem key={value} value={value}>
						{label}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	)
}
