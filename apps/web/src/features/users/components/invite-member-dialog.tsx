import { useCreateInvitation } from "@/api/generated/roles/roles.ts"
import { buildInvitationUrl, formatInvitationExpiry } from "@/features/authentication/invitation.ts"
import { getProblemMessage } from "@/lib/problem-message.ts"
import { useLanguage } from "@/lib/use-language"
import { Button } from "@talqo/ui/components/button"
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@talqo/ui/components/dialog"
import { Input } from "@talqo/ui/components/input"
import { Label } from "@talqo/ui/components/label"
import { Check, Copy, UserPlus } from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"

export function InviteMemberDialog() {
	const { t } = useTranslation()
	const { language } = useLanguage()
	const createInvitation = useCreateInvitation()
	const [open, setOpen] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [copied, setCopied] = useState(false)

	function handleOpenChange(next: boolean) {
		setOpen(next)
		if (!next) {
			// A generated link is a one-shot artifact; drop it so the next open starts clean.
			createInvitation.reset()
			setError(null)
			setCopied(false)
		}
	}

	async function handleCreate() {
		setError(null)
		setCopied(false)
		try {
			await createInvitation.mutateAsync()
		} catch (caught) {
			setError(getProblemMessage(caught, t, t("auth.errorFallback")))
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

	const invite = createInvitation.data?.data
	const inviteUrl = invite ? buildInvitationUrl(window.location.origin, invite.token) : null

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogTrigger render={<Button />} nativeButton={false}>
				<UserPlus className="size-4" />
				{t("auth.invitations.heading")}
			</DialogTrigger>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{t("auth.invitations.heading")}</DialogTitle>
					<DialogDescription>{t("auth.invitations.description")}</DialogDescription>
				</DialogHeader>
				{error ? (
					<p className="bg-destructive/10 text-destructive rounded-surface p-surface-padding text-sm" role="alert">
						{error}
					</p>
				) : null}
				{invite && inviteUrl ? (
					<div className="bg-muted/50 rounded-surface space-y-3 border p-4">
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
				<DialogFooter>
					<Button variant="outline" onClick={() => handleOpenChange(false)}>
						{t("users.cancel")}
					</Button>
					<Button type="button" onClick={handleCreate} disabled={createInvitation.isPending || Boolean(inviteUrl)}>
						{t("auth.invitations.create")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}
