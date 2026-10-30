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
	readOnly: boolean
	value: string
}

export function ColorField({ against, id, label, onChange, readOnly, value }: ColorFieldProps) {
	const { t } = useTranslation()
	const comparable = isHexColor(value) && against !== undefined && isHexColor(against)
	const ratio = comparable ? contrastRatio(value, against) : undefined
	const passes = ratio !== undefined && ratio >= CONTRAST_AA_NORMAL
	const invalid = !isHexColor(value)
	const showContrast = ratio !== undefined && !passes
	const errorId = `${id}-error`
	const contrastId = `${id}-contrast`
	const invalidId = invalid ? errorId : undefined
	const describedBy = invalidId ?? (showContrast ? contrastId : undefined)

	return (
		<div className="space-y-2">
			<Label htmlFor={id}>{label}</Label>
			<div className="flex flex-wrap items-center gap-2">
				<input
					id={id}
					type="color"
					disabled={readOnly}
					value={isHexColor(value) ? value : "#000000"}
					onChange={(event) => onChange(event.target.value)}
					className="h-control rounded-control border-input-border w-12 cursor-pointer border bg-transparent p-1"
				/>
				<Input
					id={`${id}-hex`}
					readOnly={readOnly}
					value={value}
					onChange={(event) => onChange(event.target.value)}
					font="mono"
					className="w-28"
					aria-label={t("embedSetup.hexValue", { label })}
					aria-invalid={invalid}
					aria-describedby={describedBy}
				/>
				<div id={contrastId} aria-live="polite" className={showContrast ? "w-full sm:w-auto" : "sr-only"}>
					{showContrast && (
						// A warning, not a gate: the brand color is the operator's to choose.
						<Badge variant="destructive" className="w-full sm:w-auto">
							{t("embedSetup.contrastWarning")}
						</Badge>
					)}
				</div>
			</div>
			{invalid && (
				<p id={errorId} role="alert" className="text-destructive text-xs">
					{t("embedSetup.colorInvalid")}
				</p>
			)}
		</div>
	)
}
