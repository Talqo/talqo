/* eslint-disable no-magic-numbers */
const KB = 1024
const MB = 1024 * KB
/* eslint-enable no-magic-numbers */

export function formatBytes(sizeBytes: number): string {
	if (sizeBytes >= MB) return `${(sizeBytes / MB).toFixed(1)} MB`
	if (sizeBytes >= KB) return `${(sizeBytes / KB).toFixed(1)} KB`
	return `${sizeBytes} B`
}

export function formatFileDate(iso: string, language: string): string {
	return new Intl.DateTimeFormat(language, {
		dateStyle: "medium",
		timeStyle: "short",
	}).format(new Date(iso))
}

export function splitExtension(name: string): { base: string; extension: string } {
	const dot = name.lastIndexOf(".")
	if (dot <= 0) return { base: name, extension: "" }
	return { base: name.slice(0, dot), extension: name.slice(dot) }
}
