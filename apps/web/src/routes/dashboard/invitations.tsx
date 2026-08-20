import { useGetSession } from "@/api/generated/identity/identity.ts"
import { useCreateInvitation } from "@/api/generated/roles/roles.ts"
import { PageHeader } from "@/components/page-header"
import {
	buildInvitationUrl,
	formatInvitationExpiry,
	getInvitationErrorMessage,
} from "@/features/authentication/invitation.ts"
import { useLanguage } from "@/lib/use-language"
import { Button } from "@talqo/ui/components/button"
import { Card, CardContent } from "@talqo/ui/components/card"
import { Input } from "@talqo/ui/components/input"
import { Label } from "@talqo/ui/components/label"
import { createFileRoute, Link } from "@tanstack/react-router"
import { Check, Copy } from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"

export const Route = createFileRoute("/dashboard/invitations")({
	component: InvitationsPage,
})

function InvitationsPage() {
	const { t } = useTranslation()
	const { language } = useLanguage()
	const session = useGetSession()
	const createInvitation = useCreateInvitation()
	const [error, setError] = useState<string | null>(null)
	const [copied, setCopied] = useState(false)

	async function handleCreate() {
		setError(null)
		createInvitation.reset()
		setCopied(false)
		try {
			await createInvitation.mutateAsync()
		} catch (caught) {
			setError(
				getInvitationErrorMessage(caught, {
					fallback: t("auth.errorFallback"),
					permissionDenied: t("auth.invitations.permissionDenied"),
				}),
			)
		}
	}

	async function copyInvitation(url: string) {
		setError(null)
		setCopied(false)
		try {
			await navigator.clipboard.writeText(url)
			setCopied(true)
		} catch {
			setError(t("auth.invitations.copyFailed"))
		}
	}

	if (session.isPending) {
		return (
			<div className="mx-auto max-w-2xl">
				<p className="text-muted-foreground">{t("auth.loading")}</p>
			</div>
		)
	}

	if (session.isError || session.data.data.user === null) {
		return (
			<div className="mx-auto max-w-2xl space-y-6">
				<PageHeader title={t("auth.invitations.heading")} description={t("auth.invitations.description")} />
				<Card>
					<CardContent className="space-y-4">
						<p className="text-muted-foreground text-sm">{t("auth.invitations.loginRequired")}</p>
						<Button render={<Link to="/login" />} nativeButton={false} size="lg">
							{t("auth.invitations.loginLink")}
						</Button>
					</CardContent>
				</Card>
			</div>
		)
	}

	const invite = createInvitation.data?.data
	const inviteUrl = invite ? buildInvitationUrl(window.location.origin, invite.token) : null

	return (
		<div className="mx-auto max-w-2xl space-y-6">
			<PageHeader title={t("auth.invitations.heading")} description={t("auth.invitations.description")} />
			<Card>
				<CardContent className="space-y-4">
					<Button
						className="w-full"
						size="lg"
						type="button"
						onClick={handleCreate}
						disabled={createInvitation.isPending}
					>
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
								{t("auth.invitations.expiresLabel", {
									date: formatInvitationExpiry(invite.expiresAt, language),
								})}
							</p>
							{copied ? (
								<p className="text-primary text-xs" role="status">
									{t("auth.invitations.copied")}
								</p>
							) : null}
						</div>
					) : null}
				</CardContent>
			</Card>
		</div>
	)
}
