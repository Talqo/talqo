export class ApiError extends Error {
	status: number

	constructor(status: number, message: string) {
		super(message)
		this.status = status
	}
}

export function normalizeApiError(error: unknown): ApiError | null {
	if (error instanceof ApiError) return error
	if (typeof error !== "object" || error === null || !("status" in error) || !("info" in error)) return null

	const { status, info } = error
	if (typeof status !== "number" || typeof info !== "object" || info === null || !("error" in info)) return null
	return typeof info.error === "string" ? new ApiError(status, info.error) : null
}
