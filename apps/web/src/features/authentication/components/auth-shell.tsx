import type { ReactNode } from "react"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@talqo/ui/components/card"
import { useTranslation } from "react-i18next"

type AuthShellProps = {
	children: ReactNode
	description?: string
	title: string
}

export function AuthShell({ children, description, title }: AuthShellProps) {
	const { t } = useTranslation()

	return (
		<main className="bg-background text-foreground flex min-h-screen items-center justify-center p-4 sm:p-8">
			<div className="w-full max-w-md space-y-5">
				<div className="flex items-center justify-center gap-2" aria-label={t("common.appName")}>
					<span className="bg-primary size-2.5 rounded-full" />
					<span className="text-lg font-semibold tracking-tight">{t("common.appName")}</span>
				</div>
				<Card className="shadow-sm">
					<CardHeader className="text-center">
						<CardTitle>
							<h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
						</CardTitle>
						{description ? <CardDescription>{description}</CardDescription> : null}
					</CardHeader>
					<CardContent>{children}</CardContent>
				</Card>
			</div>
		</main>
	)
}
