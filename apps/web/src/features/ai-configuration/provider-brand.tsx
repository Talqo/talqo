import type { AiProviderId } from "@/api/client.ts"

import { cn } from "@talqo/ui/lib/utils"
import { Plug } from "lucide-react"

const BRANDS: Partial<Record<AiProviderId, { mark: string; className: string }>> = {
	openai: { mark: "O", className: "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" },
	anthropic: { mark: "A", className: "bg-[#c96142] text-white dark:bg-[#d97757]" },
	google: { mark: "G", className: "bg-[#3b78e7] text-white" },
	mistral: { mark: "M", className: "bg-[#ff7000] text-white" },
	azure: { mark: "Az", className: "bg-[#0a6ed1] text-white" },
	"amazon-bedrock": { mark: "BR", className: "bg-[#f59c1f] text-zinc-900" },
}

export function ProviderBrand({ providerId, className }: { providerId: AiProviderId; className?: string }) {
	if (providerId === "openai-compatible") {
		return (
			<span
				aria-hidden
				className={cn(
					"bg-muted text-muted-foreground inline-flex size-5 shrink-0 items-center justify-center rounded-md",
					className,
				)}
			>
				<Plug className="size-3" />
			</span>
		)
	}
	const brand = BRANDS[providerId]
	return (
		<span
			aria-hidden
			className={cn(
				"inline-flex size-5 shrink-0 items-center justify-center rounded-md text-[10px] leading-none font-semibold tracking-tight",
				brand?.className,
				className,
			)}
		>
			{brand?.mark}
		</span>
	)
}
