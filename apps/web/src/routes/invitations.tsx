import type { PublicUser } from "@/api/client.ts"

import { createInvitation, getSession } from "@/api/client.ts"
import { ApiError } from "@/api/errors.ts"
import { createFileRoute, Link } from "@tanstack/react-router"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"

export const Route = createFileRoute("/invitations")({
	component: InvitationsPage,
})

function InvitationsPage() {
	const { t } = useTranslation()
	const [user, setUser] = useState<PublicUser | null | undefined>(undefined)
	const [invite, setInvite] = useState<{ expiresAt: string; token: string } | null>(null)
	const [error, setError] = useState<string | null>(null)
	const [submitting, setSubmitting] = useState(false)

	useEffect(() => {
		const controller = new AbortController()
		getSession(controller.signal)
			.then((session) => setUser(session.user))
			.catch(() => setUser(null))
		return () => controller.abort()
	}, [])

	async function handleCreate() {
		setSubmitting(true)
		setError(null)
		setInvite(null)
		try {
			setInvite(await createInvitation())
		} catch (caught) {
			setError(caught instanceof ApiError ? caught.message : t("auth.errorFallback"))
		} finally {
			setSubmitting(false)
		}
	}

	if (user === undefined) return <p>{t("auth.loading")}</p>

	if (user === null) {
		return (
			<main>
				<p>{t("auth.invitations.loginRequired")}</p>
				<p>
					<Link to="/login">{t("auth.invitations.loginLink")}</Link>
				</p>
			</main>
		)
	}

	return (
		<main>
			<h1>{t("auth.invitations.heading")}</h1>
			<button type="button" onClick={handleCreate} disabled={submitting}>
				{t("auth.invitations.create")}
			</button>
			{error ? <p role="alert">{error}</p> : null}
			{invite ? (
				<p>
					{t("auth.invitations.linkLabel")} <code>/accept-invite?token={invite.token}</code>{" "}
					{t("auth.invitations.expiresLabel", { date: new Date(invite.expiresAt).toLocaleString() })}
				</p>
			) : null}
		</main>
	)
}
