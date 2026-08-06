// Dashboard UI languages; the widget app owns its own registry (apps/widget).
export const dashboardLanguages = {
	en: "English",
	cs: "Čeština",
	zh: "中文",
} as const

export type DashboardLanguage = keyof typeof dashboardLanguages

export function isDashboardLanguage(value: unknown): value is DashboardLanguage {
	return typeof value === "string" && Object.hasOwn(dashboardLanguages, value as DashboardLanguage)
}
