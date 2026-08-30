// Orval fetch errors expose the parsed error body as `info.error`.
export function readErrorInfo(caught: unknown): string | undefined {
	return (caught as { info?: { error?: string } } | null)?.info?.error
}
