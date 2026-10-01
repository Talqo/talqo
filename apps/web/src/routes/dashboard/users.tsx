import { UsersPage } from "@/features/users/users-page.tsx"
import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/dashboard/users")({
	component: UsersPage,
})
