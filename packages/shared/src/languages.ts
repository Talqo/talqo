export const supportedLanguages = {
	en: "English",
	cs: "Čeština",
	zh: "中文",
} as const

export type SupportedLanguage = keyof typeof supportedLanguages

/** Tuple form for schema builders such as `z.enum`, which need the literal union preserved. */
export const SUPPORTED_LANGUAGES = Object.keys(supportedLanguages) as [SupportedLanguage, ...SupportedLanguage[]]

export function isSupportedLanguage(value: unknown): value is SupportedLanguage {
	return typeof value === "string" && Object.hasOwn(supportedLanguages, value as SupportedLanguage)
}
