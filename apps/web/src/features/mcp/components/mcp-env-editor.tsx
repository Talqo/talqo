import { MCP_ENV_VARIABLE_LIMIT, type EnvVariable } from "@/features/mcp/mcp-env-variables"
import { Button } from "@talqo/ui/components/button"
import { Input } from "@talqo/ui/components/input"
import { Label } from "@talqo/ui/components/label"
import { Plus, X } from "lucide-react"
import { useTranslation } from "react-i18next"

export function McpEnvEditor({
	env,
	onChange,
	kind = "env",
}: {
	env: EnvVariable[]
	onChange: (env: EnvVariable[]) => void
	kind?: "env" | "headers"
}) {
	const { t } = useTranslation()
	const set = (id: string, patch: Partial<EnvVariable>) =>
		onChange(env.map((variable) => (variable.id === id ? { ...variable, ...patch } : variable)))
	const title = kind === "headers" ? t("mcp.headers") : t("mcp.envVariables")
	const nameLabel = kind === "headers" ? t("mcp.headerName") : t("mcp.envName")
	const valueLabel = kind === "headers" ? t("mcp.headerValue") : t("mcp.envValue")

	return (
		<div className="space-y-2">
			<Label>{title}</Label>
			{env.map((variable, index) => (
				<div key={variable.id} className="flex gap-2">
					<Input
						value={variable.name}
						placeholder={nameLabel}
						aria-label={nameLabel}
						autoComplete="off"
						onChange={(event) => set(variable.id, { name: event.target.value })}
					/>
					<Input
						value={variable.value}
						type="password"
						placeholder={valueLabel}
						aria-label={valueLabel}
						autoComplete="off"
						onChange={(event) => set(variable.id, { value: event.target.value })}
					/>
					<Button
						type="button"
						variant="ghost"
						size="icon"
						aria-label={
							kind === "headers"
								? t("mcp.removeHeader", { name: variable.name.trim() || index + 1 })
								: t("mcp.removeEnv", { name: variable.name.trim() || index + 1 })
						}
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
					{kind === "headers" ? t("mcp.addHeader") : t("mcp.addEnv")}
				</Button>
				<p className="text-muted-foreground text-xs">
					{kind === "headers"
						? t("mcp.headersCount", { used: env.length, limit: MCP_ENV_VARIABLE_LIMIT })
						: t("mcp.envCount", { used: env.length, limit: MCP_ENV_VARIABLE_LIMIT })}
				</p>
			</div>
		</div>
	)
}
