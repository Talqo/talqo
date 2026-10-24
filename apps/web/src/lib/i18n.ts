import cs from "@/locales/cs.json"
import en from "@/locales/en.json"
import zh from "@/locales/zh.json"
import { init, use as registerPlugin } from "i18next"
import { initReactI18next } from "react-i18next"

import { getStoredLanguage } from "./use-language"

registerPlugin(initReactI18next)
void init({
	lng: getStoredLanguage(),
	fallbackLng: "en",
	resources: {
		en: { translation: en },
		cs: { translation: cs },
		zh: { translation: zh },
	},
	interpolation: { escapeValue: false },
	react: { useSuspense: false },
})
