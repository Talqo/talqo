import type { ReactNode } from "react"

import { Button } from "@talqo/ui/components/button"
import { Link } from "@tanstack/react-router"
import { TriangleAlert } from "lucide-react"
import { useTranslation } from "react-i18next"

function FallbackFrame({ children }: { children: ReactNode }) {
	return (
		<main className="mx-auto flex min-h-svh max-w-md flex-col items-center justify-center gap-4 px-4 py-16 text-center">
			{children}
		</main>
	)
}

export function NotFoundFallback() {
	const { t } = useTranslation()
	return (
		<FallbackFrame>
			<p aria-hidden="true" className="text-muted-foreground text-7xl font-semibold tracking-tight">
				404
			</p>
			<h1 className="text-foreground text-2xl font-semibold">{t("fallback.notFoundTitle")}</h1>
			<p className="text-muted-foreground">{t("fallback.notFoundDescription")}</p>
			<Button render={<Link to="/dashboard" />} nativeButton={false} className="mt-2">
				{t("fallback.backToDashboard")}
			</Button>
		</FallbackFrame>
	)
}

export function RouteErrorFallback() {
	const { t } = useTranslation()
	return (
		<FallbackFrame>
			<TriangleAlert aria-hidden="true" className="text-muted-foreground size-10" />
			<h1 className="text-foreground text-2xl font-semibold">{t("fallback.errorTitle")}</h1>
			<p className="text-muted-foreground">{t("fallback.errorDescription")}</p>
			<div className="flex flex-wrap justify-center gap-2 pt-2">
				<Button onClick={() => window.location.reload()}>{t("common.retry")}</Button>
				<Button variant="outline" render={<Link to="/dashboard" />} nativeButton={false}>
					{t("fallback.backToDashboard")}
				</Button>
			</div>
		</FallbackFrame>
	)
}
