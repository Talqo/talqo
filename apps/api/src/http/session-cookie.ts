import { env } from "@/config/env.ts"

// Same options for every set/clear of the session cookie so it overwrites and
// deletes cleanly across modules (identity login/logout, roles bootstrap/redeem).
export function sessionCookieOptions() {
	return {
		httpOnly: true,
		sameSite: "Lax" as const,
		secure: env.NODE_ENV === "production",
		path: "/",
	}
}
