import { createFileRoute, redirect } from "@tanstack/react-router"

export const Route = createFileRoute("/dashboard/roles")({
	beforeLoad: () => {
		throw redirect({ to: "/dashboard/users/roles" })
	},
})
