const UNAUTHORIZED_STATUS = 401

export type SessionUser = { mustChangePassword: boolean }

export type SessionOutcome = "ok" | "login" | "passwordChange"

// Only a real authentication failure ends the session; a server or network failure is a
// load error the page can retry without signing the operator out.
export async function resolveDashboardSession(load: () => Promise<SessionUser | null>): Promise<SessionOutcome> {
	let user: SessionUser | null
	try {
		user = await load()
	} catch (error) {
		if ((error as { status?: number } | null)?.status === UNAUTHORIZED_STATUS) return "login"
		throw error
	}
	if (!user) return "login"
	return user.mustChangePassword ? "passwordChange" : "ok"
}
