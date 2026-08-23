// Orval fetch errors expose the status and parsed error body as `info`.
type ApiError = { info?: { error?: string }; status?: number } | null

export function apiErrorStatus(error: unknown): number | undefined {
	return (error as ApiError)?.status
}
