import { Button } from "@talqo/ui/components/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@talqo/ui/components/card"
import { Check, Copy } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"

import { apiOriginOverride, buildEmbedSnippet } from "./-embed-snippet"

const COPY_FEEDBACK_MS = 2000

function snippetFor(embedToken: string): string | undefined {
	const configuredScriptUrl = import.meta.env.VITE_WIDGET_CDN_URL
	const scriptUrl = configuredScriptUrl ?? `${window.location.origin}/widget.js`
	if (!scriptUrl) {
		return undefined
	}
	return buildEmbedSnippet(scriptUrl, {
		embedToken,
		apiOrigin: apiOriginOverride(scriptUrl, window.location.origin),
	})
}

export function EmbedCodeCard({ embedToken, isDisabled }: { embedToken: string; isDisabled: boolean }) {
	const { t } = useTranslation()
	const [copied, setCopied] = useState(false)
	const copyTimeout = useRef<number | undefined>(undefined)
	const snippet = snippetFor(embedToken)

	useEffect(() => {
		return () => window.clearTimeout(copyTimeout.current)
	}, [])

	async function copySnippet() {
		if (!snippet) {
			return
		}
		try {
			await navigator.clipboard.writeText(snippet)
			setCopied(true)
			window.clearTimeout(copyTimeout.current)
			copyTimeout.current = window.setTimeout(() => setCopied(false), COPY_FEEDBACK_MS)
		} catch {
			setCopied(false)
		}
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle>{t("embedSetup.embedCode")}</CardTitle>
				<CardDescription>{t("embedSetup.embedDescription")}</CardDescription>
			</CardHeader>
			<CardContent>
				<div className="space-y-3">
					<div className="relative">
						<pre className="bg-muted rounded-surface overflow-x-auto border p-4 font-mono text-sm">{snippet}</pre>
						<Button
							variant="outline"
							size="icon"
							className="absolute top-2 right-2"
							onClick={copySnippet}
							aria-label={t("embedSetup.copyEmbed")}
						>
							{copied ? <Check className="text-primary size-4" /> : <Copy className="size-4" />}
						</Button>
					</div>
					{isDisabled && <p className="text-muted-foreground text-sm">{t("embedSetup.embedDisabledNote")}</p>}
				</div>
			</CardContent>
		</Card>
	)
}
