import { createFileRoute, redirect } from "@tanstack/react-router"

// The landing page is not ported yet; the login page will replace / later.
export const Route = createFileRoute("/")({
	beforeLoad: () => {
		throw redirect({ to: "/dashboard" })
	},
})
