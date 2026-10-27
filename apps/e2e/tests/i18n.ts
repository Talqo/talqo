import { createInstance, type i18n as I18nInstance, type ResourceLanguage } from "i18next"
import { readFileSync } from "node:fs"
import path from "node:path"

type Values = Record<string, string | number>

const webI18n = create("web", load("../../web/src/locales/en.json"))
const widgetI18n = create("widget", load("../../widget/src/locales/en.json"))

function load(relativePath: string): ResourceLanguage {
	return JSON.parse(readFileSync(path.resolve(import.meta.dirname, relativePath), "utf8")) as ResourceLanguage
}

function create(name: string, translation: ResourceLanguage): I18nInstance {
	const instance = createInstance()
	void instance.init({
		lng: "en",
		resources: { en: { [name]: translation } },
		defaultNS: name,
		initAsync: false,
		interpolation: { escapeValue: false },
	})
	return instance
}

function translate(instance: I18nInstance, key: string, values?: Values): string {
	if (!instance.exists(key, values)) throw new Error(`Missing translation key: ${key}`)
	return instance.t(key, values)
}

/** Expected dashboard labels, resolved from the catalog the app ships. */
export function web(key: string, values?: Values): string {
	return translate(webI18n, key, values)
}

/** Expected widget labels, resolved from the catalog the app ships. */
export function widget(key: string, values?: Values): string {
	return translate(widgetI18n, key, values)
}
