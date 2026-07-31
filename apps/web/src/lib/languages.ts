// Languages the dashboard UI is translated into. The widget app owns its own
// registry in apps/widget/src/lib/i18n.ts; the two may diverge, and the
// dashboard talks to the widget only through URL parameters, never imports.
export const dashboardLanguages = {
	en: "English",
	cs: "Čeština",
	zh: "中文",
} as const

export type DashboardLanguage = keyof typeof dashboardLanguages

export function isDashboardLanguage(value: unknown): value is DashboardLanguage {
	return typeof value === "string" && Object.hasOwn(dashboardLanguages, value as DashboardLanguage)
}
