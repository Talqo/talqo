import { getSetupStatus } from "@/api/generated/roles/roles.ts"
import { createFileRoute, redirect } from "@tanstack/react-router"
import { useTranslation } from "react-i18next"

// TODO(landing): the landing page is not ported yet; the login page will replace / later.
export const Route = createFileRoute("/")({
	beforeLoad: async () => {
		let needsSetup = false
		try {
			const response = await getSetupStatus()
			needsSetup = response.data.needsSetup
		} catch {
			throw redirect({ to: "/login" })
		}
		throw redirect({ to: needsSetup ? "/setup" : "/login" })
	},
	component: LoadingPlaceholder,
})

function LoadingPlaceholder() {
	const { t } = useTranslation()
	return <p>{t("auth.loading")}</p>
}
