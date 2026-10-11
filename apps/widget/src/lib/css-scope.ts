export const WIDGET_SCOPE = ".talqo-widget"

export function isScopedSelector(selector: string): boolean {
	return (
		selector.startsWith(WIDGET_SCOPE) || selector.startsWith(`:where(${WIDGET_SCOPE})`) || selector.includes(".tw\\:")
	)
}
