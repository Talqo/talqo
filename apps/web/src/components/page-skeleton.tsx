import { Skeleton } from "@talqo/ui/components/skeleton"
import { cn } from "@talqo/ui/lib/utils"
import { useTranslation } from "react-i18next"

export function PageSkeleton({ className }: { className?: string }) {
	return (
		<div className={cn("mx-auto w-full max-w-5xl space-y-6", className)} aria-busy="true">
			<div className="space-y-3">
				<Skeleton className="h-8 w-56 max-w-full" />
				<Skeleton className="h-4 w-80 max-w-full" />
			</div>
			<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
				{Array.from({ length: 6 }, (_, index) => (
					<Skeleton key={index} className="h-24" />
				))}
			</div>
		</div>
	)
}

// Shown while a route's beforeLoad or loader is still resolving, before any layout mounts.
export function PendingPage() {
	const { t } = useTranslation()
	return (
		<div className="p-6">
			<output className="sr-only">{t("auth.loading")}</output>
			<PageSkeleton />
		</div>
	)
}
