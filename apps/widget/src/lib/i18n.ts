import cs from "@/locales/cs.json"
import en from "@/locales/en.json"
import { isSupportedLanguage, type SupportedLanguage } from "@talqo/shared"
import { createInstance, type i18n as I18nInstance } from "i18next"
import { initReactI18next } from "react-i18next"

export type WidgetLanguage = SupportedLanguage

export const isWidgetLanguage = isSupportedLanguage

export function createWidgetI18n(language: WidgetLanguage = "en"): I18nInstance {
	const instance = createInstance()
	void instance.use(initReactI18next).init({
		lng: language,
		fallbackLng: "en",
		resources: {
			en: { translation: en },
			cs: { translation: cs },
		},
		interpolation: { escapeValue: false },
	})
	return instance
}
