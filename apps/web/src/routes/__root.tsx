import logoUrl from "@talqo/ui/assets/logo.svg"
import { createRootRoute, Outlet } from "@tanstack/react-router"

export const Route = createRootRoute({
	component: Root,
})

function Root() {
	return (
		<>
			<link rel="icon" type="image/svg+xml" href={logoUrl} />
			<Outlet />
		</>
	)
}
