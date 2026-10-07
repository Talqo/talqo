import { MCP_ENV_VARIABLE_LIMIT, type EnvVariable } from "@/features/mcp/mcp-env-variables"
import { Button } from "@talqo/ui/components/button"
import { Input } from "@talqo/ui/components/input"
import { Label } from "@talqo/ui/components/label"
import { Plus, X } from "lucide-react"
import { useTranslation } from "react-i18next"

/** Rows are added empty and typed in place, so saving can never silently drop a variable. */
export function McpEnvEditor({ env, onChange }: { env: EnvVariable[]; onChange: (env: EnvVariable[]) => void }) {
	const { t } = useTranslation()
	const set = (id: string, patch: Partial<EnvVariable>) =>
		onChange(env.map((variable) => (variable.id === id ? { ...variable, ...patch } : variable)))

	return (
		<div className="space-y-2">
			<Label>{t("mcp.envVariables")}</Label>
			{env.map((variable, index) => (
				<div key={variable.id} className="flex gap-2">
					<Input
						value={variable.name}
						placeholder={t("mcp.envName")}
						aria-label={t("mcp.envName")}
						autoComplete="off"
						onChange={(event) => set(variable.id, { name: event.target.value })}
					/>
					<Input
						value={variable.value}
						type="password"
						placeholder={t("mcp.envValue")}
						aria-label={t("mcp.envValue")}
						autoComplete="off"
						onChange={(event) => set(variable.id, { value: event.target.value })}
					/>
					<Button
						type="button"
						variant="ghost"
						size="icon"
						aria-label={t("mcp.removeEnv", { name: variable.name.trim() || index + 1 })}
						onClick={() => onChange(env.filter((candidate) => candidate.id !== variable.id))}
					>
						<X className="size-4" />
					</Button>
				</div>
			))}
			<div className="flex items-center gap-2">
				<Button
					type="button"
					variant="outline"
					disabled={env.length >= MCP_ENV_VARIABLE_LIMIT}
					onClick={() => onChange([...env, { id: crypto.randomUUID(), name: "", value: "" }])}
				>
					<Plus className="size-4" />
					{t("mcp.addEnv")}
				</Button>
				<p className="text-muted-foreground text-xs">
					{t("mcp.envCount", { used: env.length, limit: MCP_ENV_VARIABLE_LIMIT })}
				</p>
			</div>
		</div>
	)
}
