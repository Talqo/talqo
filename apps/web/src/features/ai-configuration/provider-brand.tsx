import type { AiProviderId } from "@/api/client.ts"

import { cn } from "@talqo/ui/lib/utils"
import { Plug } from "lucide-react"

import amazonwebservicesLogo from "./logos/amazonwebservices.svg"
import anthropicLogo from "./logos/anthropic.svg"
import googlegeminiLogo from "./logos/googlegemini.svg"
import microsoftazureLogo from "./logos/microsoftazure.svg"
import mistralaiLogo from "./logos/mistralai.svg"
import openaiLogo from "./logos/openai.svg"

const LOGOS: Partial<Record<AiProviderId, { src: string; label: string }>> = {
	openai: { src: openaiLogo, label: "OpenAI" },
	anthropic: { src: anthropicLogo, label: "Anthropic" },
	google: { src: googlegeminiLogo, label: "Google Gemini" },
	mistral: { src: mistralaiLogo, label: "Mistral AI" },
	azure: { src: microsoftazureLogo, label: "Microsoft Azure" },
	"amazon-bedrock": { src: amazonwebservicesLogo, label: "Amazon Web Services" },
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
	const logo = LOGOS[providerId]
	if (!logo) return null
	return (
		<span
			className={cn(
				"border-border inline-flex size-5 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-white p-0.5 shadow-xs",
				className,
			)}
		>
			<img src={logo.src} alt={logo.label} className="max-h-full max-w-full object-contain" />
		</span>
	)
}
