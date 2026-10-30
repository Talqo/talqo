import { addBlacklistTerm, BLACKLIST_TERM_LIMIT, removeBlacklistTerm } from "@/features/agents/blacklist-terms"
import { Badge } from "@talqo/ui/components/badge"
import { Button } from "@talqo/ui/components/button"
import { Input } from "@talqo/ui/components/input"
import { X } from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"

export function BlacklistTermsEditor({
	value,
	onChange,
	disabled = false,
	id,
}: {
	value: string[]
	onChange: (terms: string[]) => void
	disabled?: boolean
	id: string
}) {
	const { t } = useTranslation()
	const [draft, setDraft] = useState("")
	// Polite announcements for add/remove; assertive alert for rejected adds.
	const [error, setError] = useState<string | null>(null)
	const [announcement, setAnnouncement] = useState("")

	function handleAdd() {
		const result = addBlacklistTerm(value, draft)
		if (!result.ok) {
			setAnnouncement("")
			setError(
				result.reason === "empty"
					? t("blacklist.emptyError")
					: result.reason === "duplicate"
						? t("blacklist.duplicateError", { word: draft.trim() })
						: t("blacklist.limitError", { limit: BLACKLIST_TERM_LIMIT }),
			)
			return
		}
		setError(null)
		setDraft("")
		onChange(result.terms)
		setAnnouncement(t("blacklist.added", { word: result.term }))
	}

	function handleRemove(term: string) {
		setError(null)
		onChange(removeBlacklistTerm(value, term))
		setAnnouncement(t("blacklist.removed", { word: term }))
	}

	return (
		<div className="space-y-2">
			{!disabled && (
				<div className="flex gap-2">
					<Input
						id={id}
						value={draft}
						placeholder={t("blacklist.termPlaceholder")}
						aria-invalid={error ? true : undefined}
						aria-describedby={`${id}-help`}
						onChange={(event) => {
							setDraft(event.target.value)
							setError(null)
						}}
						onKeyDown={(event) => {
							if (event.key === "Enter") {
								event.preventDefault() // Enter adds a term, not the form.
								handleAdd()
							}
						}}
					/>
					<Button type="button" variant="outline" onClick={handleAdd}>
						{t("blacklist.addTerm")}
					</Button>
				</div>
			)}
			<p id={`${id}-help`} className="text-muted-foreground text-xs">
				{t("blacklist.help")}
			</p>
			{error && (
				<p role="alert" className="text-destructive text-xs">
					{error}
				</p>
			)}
			<p aria-live="polite" className="sr-only">
				{announcement}
			</p>
			<p className="text-muted-foreground text-xs">
				{t("blacklist.count", { used: value.length, limit: BLACKLIST_TERM_LIMIT })}
			</p>
			{value.length > 0 && (
				<ul className="flex flex-wrap gap-1" aria-label={t("blacklist.termsLabel")}>
					{value.map((term) => (
						<Badge key={term} variant="outline" render={<li />} className="overflow-visible">
							{term}
							{!disabled && (
								<button
									type="button"
									onClick={() => handleRemove(term)}
									aria-label={t("blacklist.removeTerm", { word: term })}
									className="hover:text-destructive focus-visible:ring-ring -mr-1.5 ml-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full focus-visible:ring-2 focus-visible:outline-none"
								>
									<X className="size-3" aria-hidden="true" />
								</button>
							)}
						</Badge>
					))}
				</ul>
			)}
		</div>
	)
}
