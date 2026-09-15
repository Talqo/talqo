export function widgetPreviewUrl(previewUrl: string | undefined, widgetUrl: string | undefined): string | undefined {
	if (previewUrl) return previewUrl
	if (!widgetUrl) return undefined
	try {
		const widget = new URL(widgetUrl)
		const preview = new URL("preview.html", widget)
		if (widget.search.length > 1) preview.searchParams.set("widgetAssetQuery", widget.search.slice(1))
		return preview.toString()
	} catch {
		return undefined
	}
}
