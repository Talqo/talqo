import { createFileRoute, redirect } from "@tanstack/react-router"

// TODO(landing): the landing page is not ported yet; the login page will replace / later.
export const Route = createFileRoute("/")({
	beforeLoad: () => {
		throw redirect({ to: "/dashboard" })
	},
})
