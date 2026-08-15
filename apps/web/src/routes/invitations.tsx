import { createFileRoute, redirect } from "@tanstack/react-router"

export const Route = createFileRoute("/invitations")({
	beforeLoad: () => {
		throw redirect({ to: "/dashboard/invitations" })
	},
	component: InvitationsRedirect,
})

function InvitationsRedirect() {
	return null
}
