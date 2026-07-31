import cs from "@/locales/cs.json"
import en from "@/locales/en.json"
import zh from "@/locales/zh.json"
import { createInstance, type i18n as I18nInstance } from "i18next"
import { initReactI18next } from "react-i18next"

export const widgetLanguages = {
	en: "English",
	cs: "Čeština",
	zh: "中文",
} as const

export type WidgetLanguage = keyof typeof widgetLanguages

export function isWidgetLanguage(value: unknown): value is WidgetLanguage {
	return typeof value === "string" && Object.hasOwn(widgetLanguages, value as WidgetLanguage)
}

// Isolated instance: the host page may run its own i18next.
export function createWidgetI18n(language: WidgetLanguage = "en"): I18nInstance {
	const instance = createInstance()
	instance.use(initReactI18next).init({
		lng: language,
		fallbackLng: "en",
		resources: {
			en: { translation: en },
			cs: { translation: cs },
			zh: { translation: zh },
		},
		interpolation: { escapeValue: false },
	})
	return instance
}
