import { CONTRAST_AA_NORMAL, contrastRatio, isHexColor } from "@talqo/shared/widget-appearance"
import { Badge } from "@talqo/ui/components/badge"
import { Input } from "@talqo/ui/components/input"
import { Label } from "@talqo/ui/components/label"
import { useTranslation } from "react-i18next"

type ColorFieldProps = {
	/** The other half of the pair this color must stay readable against. */
	against?: string
	id: string
	label: string
	onChange: (value: string) => void
	value: string
}

export function ColorField({ against, id, label, onChange, value }: ColorFieldProps) {
	const { t } = useTranslation()
	const comparable = isHexColor(value) && against !== undefined && isHexColor(against)
	const ratio = comparable ? contrastRatio(value, against) : undefined
	const passes = ratio !== undefined && ratio >= CONTRAST_AA_NORMAL

	return (
		<div className="space-y-2">
			<Label htmlFor={id}>{label}</Label>
			<div className="flex items-center gap-2">
				<input
					id={id}
					type="color"
					value={isHexColor(value) ? value : "#000000"}
					onChange={(event) => onChange(event.target.value)}
					className="h-9 w-12 cursor-pointer rounded-md border bg-transparent p-1"
				/>
				<Input
					value={value}
					onChange={(event) => onChange(event.target.value)}
					className="w-28 font-mono"
					aria-label={t("widgetSetup.hexValue", { label })}
					aria-invalid={isHexColor(value) ? undefined : true}
				/>
				{ratio !== undefined &&
					!passes && (
						// A warning, not a gate: the brand color is the operator's to choose.
						<Badge variant="destructive">{t("widgetSetup.contrastWarning")}</Badge>
					)}
			</div>
			{!isHexColor(value) && <p className="text-destructive text-xs">{t("widgetSetup.colorInvalid")}</p>}
		</div>
	)
}
