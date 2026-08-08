import cs from "@/locales/cs.json"
import en from "@/locales/en.json"
import zh from "@/locales/zh.json"
import { init, use } from "i18next"
import { initReactI18next } from "react-i18next"

import { getStoredLanguage } from "./use-language"

// Dashboard translations on the default i18next instance; the LanguageProvider
// calls changeLanguage when the operator switches language.
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
