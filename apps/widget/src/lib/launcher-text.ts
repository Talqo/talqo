import type { SupportedLanguage } from "@talqo/shared"

import cs from "@/locales/cs.json"
import en from "@/locales/en.json"

type LauncherStrings = { openChat: string; errorTransport: string }

const TEXT: Record<SupportedLanguage, LauncherStrings> = { en, cs }

export function launcherText(language: SupportedLanguage): LauncherStrings {
	return TEXT[language]
}
