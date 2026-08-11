export const supportedLanguages = {
	en: "English",
	cs: "Čeština",
	zh: "中文",
} as const

export type SupportedLanguage = keyof typeof supportedLanguages

export function isSupportedLanguage(value: unknown): value is SupportedLanguage {
	return typeof value === "string" && Object.hasOwn(supportedLanguages, value as SupportedLanguage)
}
