import { MCP_ARGUMENT_LIMIT, type ArgumentRow } from "@/features/mcp/mcp-arguments"
import { Button } from "@talqo/ui/components/button"
import { Input } from "@talqo/ui/components/input"
import { Label } from "@talqo/ui/components/label"
import { Plus, X } from "lucide-react"
import { useTranslation } from "react-i18next"

/** Rows are added empty and typed in place, so saving can never silently drop an argument. */
export function McpArgumentsEditor({
	args,
	onChange,
}: {
	args: ArgumentRow[]
	onChange: (args: ArgumentRow[]) => void
}) {
	const { t } = useTranslation()
	const set = (id: string, value: string) => onChange(args.map((row) => (row.id === id ? { ...row, value } : row)))

	return (
		<div className="space-y-2">
			<Label>{t("mcp.arguments")}</Label>
			{args.map((row, index) => (
				<div key={row.id} className="flex gap-2">
					<Input
						value={row.value}
						placeholder={t("mcp.argumentPlaceholder")}
						aria-label={t("mcp.arguments")}
						autoComplete="off"
						onChange={(event) => set(row.id, event.target.value)}
					/>
					<Button
						type="button"
						variant="ghost"
						size="icon"
						aria-label={t("mcp.removeArgument", { argument: row.value.trim() || index + 1 })}
						onClick={() => onChange(args.filter((candidate) => candidate.id !== row.id))}
					>
						<X className="size-4" />
					</Button>
				</div>
			))}
			<div className="flex items-center gap-2">
				<Button
					type="button"
					variant="outline"
					disabled={args.length >= MCP_ARGUMENT_LIMIT}
					onClick={() => onChange([...args, { id: crypto.randomUUID(), value: "" }])}
				>
					<Plus className="size-4" />
					{t("mcp.addArgument")}
				</Button>
				<p className="text-muted-foreground text-xs">
					{t("mcp.argumentsCount", { used: args.length, limit: MCP_ARGUMENT_LIMIT })}
				</p>
			</div>
		</div>
	)
}
