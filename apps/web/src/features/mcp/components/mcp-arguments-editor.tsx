import type { ConnectionDraft } from "@/features/mcp/connection-body"

import { addArgument, MCP_ARGUMENT_LIMIT, removeArgument } from "@/features/mcp/mcp-arguments"
import { Badge } from "@talqo/ui/components/badge"
import { Button } from "@talqo/ui/components/button"
import { Input } from "@talqo/ui/components/input"
import { Label } from "@talqo/ui/components/label"
import { Plus, X } from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"

/**
 * One argument at a time, because a textarea that expects one per line is a quoting and
 * word-splitting lesson dressed up as a text field.
 */
export function McpArgumentsEditor({
	draft,
	onChange,
}: {
	draft: ConnectionDraft
	onChange: (draft: ConnectionDraft) => void
}) {
	const { t } = useTranslation()
	const [input, setInput] = useState("")
	const [error, setError] = useState<string | null>(null)

	function handleAdd() {
		const result = addArgument(draft.args, input)
		if (!result.ok) {
			setError(
				result.reason === "empty"
					? t("mcp.errorArgumentEmpty")
					: result.reason === "duplicate"
						? t("mcp.errorArgumentDuplicate")
						: t("mcp.errorArgumentLimit"),
			)
			return
		}
		setError(null)
		setInput("")
		onChange({ ...draft, args: result.args })
	}

	return (
		<div className="space-y-2">
			<Label htmlFor="mcp-arg">{t("mcp.arguments")}</Label>
			<div className="flex gap-2">
				<Input
					id="mcp-arg"
					value={input}
					placeholder={t("mcp.argumentPlaceholder")}
					aria-invalid={error ? true : undefined}
					onChange={(event) => {
						setInput(event.target.value)
						setError(null)
					}}
					onKeyDown={(event) => {
						if (event.key === "Enter") {
							event.preventDefault()
							handleAdd()
						}
					}}
				/>
				<Button type="button" variant="outline" onClick={handleAdd}>
					<Plus className="size-4" />
					{t("mcp.addArgument")}
				</Button>
			</div>
			{error && (
				<p role="alert" className="text-destructive text-xs">
					{error}
				</p>
			)}
			{draft.args.length > 0 && (
				<ul className="flex flex-wrap gap-1" aria-label={t("mcp.argumentsLabel")}>
					{draft.args.map((argument) => (
						<Badge key={argument} variant="outline" render={<li />}>
							<span className="font-mono">{argument}</span>
							<button
								type="button"
								onClick={() => onChange({ ...draft, args: removeArgument(draft.args, argument) })}
								aria-label={t("mcp.removeArgument", { argument })}
								className="hover:text-destructive -mr-0.5 ml-1 rounded-full"
							>
								<X className="size-3" />
							</button>
						</Badge>
					))}
				</ul>
			)}
			<p className="text-muted-foreground text-xs">
				{t("mcp.argumentsCount", { used: draft.args.length, limit: MCP_ARGUMENT_LIMIT })}
			</p>
		</div>
	)
}
