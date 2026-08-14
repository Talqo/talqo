import type { PublicUser } from "@/api/client.ts"

import { createInvitation, getSession } from "@/api/client.ts"
import { AuthShell } from "@/features/authentication/components/auth-shell.tsx"
import { buildInvitationUrl, getInvitationErrorMessage } from "@/features/authentication/invitation.ts"
import { Button } from "@talqo/ui/components/button"
import { Input } from "@talqo/ui/components/input"
import { Label } from "@talqo/ui/components/label"
import { createFileRoute, Link } from "@tanstack/react-router"
import { Check, Copy } from "lucide-react"
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
	const [copied, setCopied] = useState(false)

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
		setCopied(false)
		try {
			setInvite(await createInvitation())
		} catch (caught) {
			setError(
				getInvitationErrorMessage(caught, {
					fallback: t("auth.errorFallback"),
					permissionDenied: t("auth.invitations.permissionDenied"),
				}),
			)
		} finally {
			setSubmitting(false)
		}
	}

	async function copyInvitation(url: string) {
		try {
			await navigator.clipboard.writeText(url)
			setCopied(true)
		} catch {
			setError(t("auth.invitations.copyFailed"))
		}
	}

	if (user === undefined) {
		return (
			<main className="bg-background text-muted-foreground flex min-h-screen items-center justify-center p-4">
				<p>{t("auth.loading")}</p>
			</main>
		)
	}

	if (user === null) {
		return (
			<AuthShell title={t("auth.invitations.heading")}>
				<div className="space-y-4 text-center">
					<p className="text-muted-foreground text-sm">{t("auth.invitations.loginRequired")}</p>
					<Button render={<Link to="/login" />} nativeButton={false} className="w-full" size="lg">
						{t("auth.invitations.loginLink")}
					</Button>
				</div>
			</AuthShell>
		)
	}

	const inviteUrl = invite ? buildInvitationUrl(window.location.origin, invite.token) : null

	return (
		<AuthShell title={t("auth.invitations.heading")} description={t("auth.invitations.description")}>
			<div className="space-y-4">
				<Button className="w-full" size="lg" type="button" onClick={handleCreate} disabled={submitting}>
					{t("auth.invitations.create")}
				</Button>
				{error ? (
					<p className="bg-destructive/10 text-destructive rounded-lg p-3 text-sm" role="alert">
						{error}
					</p>
				) : null}
				{invite && inviteUrl ? (
					<div className="bg-muted/50 space-y-2 rounded-xl border p-3">
						<Label htmlFor="invitation-link">{t("auth.invitations.linkLabel")}</Label>
						<div className="flex gap-2">
							<Input id="invitation-link" className="font-mono text-xs" value={inviteUrl} readOnly />
							<Button
								variant="outline"
								size="icon"
								type="button"
								onClick={() => copyInvitation(inviteUrl)}
								aria-label={t("auth.invitations.copy")}
							>
								{copied ? <Check className="text-primary" /> : <Copy />}
							</Button>
						</div>
						<p className="text-muted-foreground text-xs">
							{t("auth.invitations.expiresLabel", { date: new Date(invite.expiresAt).toLocaleString() })}
						</p>
						{copied ? (
							<p className="text-primary text-xs" role="status">
								{t("auth.invitations.copied")}
							</p>
						) : null}
					</div>
				) : null}
			</div>
		</AuthShell>
	)
}
