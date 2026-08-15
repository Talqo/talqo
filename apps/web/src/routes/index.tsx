import { getSetupStatus } from "@/api/client.ts"
import { createFileRoute, redirect } from "@tanstack/react-router"
import { useTranslation } from "react-i18next"

// TODO(landing): the landing page is not ported yet; the login page will replace / later.
export const Route = createFileRoute("/")({
	beforeLoad: async () => {
		let needsSetup = false
		try {
			const status = await getSetupStatus()
			needsSetup = status.needsSetup
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
