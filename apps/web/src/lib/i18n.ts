import cs from "@/locales/cs.json"
import en from "@/locales/en.json"
import zh from "@/locales/zh.json"
import { changeLanguage, init, use } from "i18next"
import { initReactI18next } from "react-i18next"

import { getStoredLanguage, subscribeLanguage } from "./use-language"

// Dashboard translations on the default i18next instance; language tracks
// lib/use-language.ts.
use(initReactI18next)
init({
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

subscribeLanguage(() => {
	changeLanguage(getStoredLanguage())
})
