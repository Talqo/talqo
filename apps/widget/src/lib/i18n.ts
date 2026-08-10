import cs from "@/locales/cs.json"
import en from "@/locales/en.json"
import zh from "@/locales/zh.json"
import { isSupportedLanguage, supportedLanguages, type SupportedLanguage } from "@talqo/shared"
import { createInstance, type i18n as I18nInstance } from "i18next"
import { initReactI18next } from "react-i18next"

export const widgetLanguages = supportedLanguages

export type WidgetLanguage = SupportedLanguage

export const isWidgetLanguage = isSupportedLanguage

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
