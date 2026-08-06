import type { PublicUser } from "@/api/client.ts"

import { createInvitation, getSession } from "@/api/client.ts"
import { ApiError } from "@/api/errors.ts"
import { createFileRoute, Link } from "@tanstack/react-router"
import { useEffect, useState } from "react"

export const Route = createFileRoute("/invitations")({
	component: InvitationsPage,
})

function InvitationsPage() {
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
			setError(caught instanceof ApiError ? caught.message : "Something went wrong. Please try again.")
		} finally {
			setSubmitting(false)
		}
	}

	if (user === undefined) return <p>Loading…</p>

	if (user === null) {
		return (
			<main>
				<p>
					You need to <Link to="/login">log in</Link> to invite a member.
				</p>
			</main>
		)
	}

	return (
		<main>
			<h1>Invite a member</h1>
			<button type="button" onClick={handleCreate} disabled={submitting}>
				Create invitation
			</button>
			{error ? <p role="alert">{error}</p> : null}
			{invite ? (
				<p>
					Invitation link: <code>/accept-invite?token={invite.token}</code> (expires{" "}
					{new Date(invite.expiresAt).toLocaleString()})
				</p>
			) : null}
		</main>
	)
}
