import type { EmbedFormValues } from "@/features/embeds/embed-appearance-form"

import { EMBED_ICON_MAX_BYTES, EMBED_ICON_MAX_KB, isSvgDocument, svgDataUrl } from "@talqo/shared/embed-icon"
import logoUrl from "@talqo/ui/assets/logo.svg"
import { Button } from "@talqo/ui/components/button"
import { Upload } from "lucide-react"
import { useRef, useState } from "react"
import { useTranslation } from "react-i18next"

type IconValue = EmbedFormValues["icon"]

type EmbedIconFieldProps = {
	canManage: boolean
	onChange: (value: IconValue) => void
	value: IconValue
}

/** Stages the icon in the form; the appearance save uploads or removes it. */
export function EmbedIconField({ canManage, onChange, value }: EmbedIconFieldProps) {
	const { t } = useTranslation()
	const inputRef = useRef<HTMLInputElement>(null)
	const [error, setError] = useState<string | null>(null)

	async function pick(file: File | undefined) {
		if (inputRef.current) inputRef.current.value = ""
		if (!file) return
		setError(null)
		if (file.size > EMBED_ICON_MAX_BYTES) {
			setError(t("embedSetup.iconTooLarge", { maxKB: EMBED_ICON_MAX_KB }))
			return
		}
		const markup = await file.text()
		if (!isSvgDocument(markup)) {
			setError(t("problems.embed-icon-invalid"))
			return
		}
		onChange({ url: svgDataUrl(markup), file })
	}

	function resetToDefault() {
		setError(null)
		onChange({ url: null })
	}

	return (
		<div className="space-y-2">
			<p className="text-sm font-medium">{t("embedSetup.icon")}</p>
			<div className="flex flex-wrap items-center gap-3">
				<div className="bg-muted flex size-12 shrink-0 items-center justify-center rounded-full border">
					{/* <img> only: an inlined operator SVG could run script in the dashboard. */}
					<img
						src={value.url ?? logoUrl}
						alt={value.url ? t("embedSetup.iconCustomAlt") : t("embedSetup.iconDefaultAlt")}
						className="size-7 object-contain"
					/>
				</div>
				{canManage && (
					<>
						<input
							ref={inputRef}
							type="file"
							accept=".svg,image/svg+xml"
							hidden
							onChange={(event) => void pick(event.target.files?.[0])}
						/>
						<Button type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()}>
							<Upload className="size-4" />
							{t("embedSetup.iconUpload")}
						</Button>
						{value.url && (
							<Button type="button" variant="ghost" size="sm" onClick={resetToDefault}>
								{t("embedSetup.iconReset")}
							</Button>
						)}
					</>
				)}
			</div>
			<p className="text-muted-foreground text-xs">{t("embedSetup.iconHelp", { maxKB: EMBED_ICON_MAX_KB })}</p>
			{error && (
				<p role="alert" className="text-destructive text-xs">
					{error}
				</p>
			)}
		</div>
	)
}
