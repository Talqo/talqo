const NOT_FOUND_STATUS = 404

export function embedNotFound(error: unknown): boolean {
	return (error as { status?: number } | null)?.status === NOT_FOUND_STATUS
}
