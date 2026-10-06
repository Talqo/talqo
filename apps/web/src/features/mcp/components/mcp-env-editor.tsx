import {
	addEnvVariable,
	MCP_ENV_VARIABLE_LIMIT,
	removeEnvVariable,
	type EnvVariable,
} from "@/features/mcp/mcp-env-variables"
import { Badge } from "@talqo/ui/components/badge"
import { Button } from "@talqo/ui/components/button"
import { Input } from "@talqo/ui/components/input"
import { Label } from "@talqo/ui/components/label"
import { Plus, X } from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"

/** A program usually needs more than one variable, so this is a list rather than a single pair. */
export function McpEnvEditor({ env, onChange }: { env: EnvVariable[]; onChange: (env: EnvVariable[]) => void }) {
	const { t } = useTranslation()
	const [name, setName] = useState("")
	const [value, setValue] = useState("")
	const [error, setError] = useState<string | null>(null)

	function handleAdd() {
		const result = addEnvVariable(env, { name, value })
		if (!result.ok) {
			setError(
				result.reason === "emptyName"
					? t("mcp.errorEnvName")
					: result.reason === "duplicate"
						? t("mcp.errorEnvDuplicate")
						: t("mcp.errorEnvLimit"),
			)
			return
		}
		setError(null)
		setName("")
		setValue("")
		onChange(result.env)
	}

	return (
		<div className="space-y-2">
			<Label htmlFor="mcp-env-name">{t("mcp.envVariables")}</Label>
			<div className="flex gap-2">
				<Input
					id="mcp-env-name"
					value={name}
					placeholder={t("mcp.envName")}
					aria-invalid={error ? true : undefined}
					onChange={(event) => {
						setName(event.target.value)
						setError(null)
					}}
				/>
				<Input
					value={value}
					type="password"
					placeholder={t("mcp.envValue")}
					onChange={(event) => setValue(event.target.value)}
				/>
				<Button type="button" variant="outline" onClick={handleAdd}>
					<Plus className="size-4" />
					{t("mcp.addEnv")}
				</Button>
			</div>
			{error && (
				<p role="alert" className="text-destructive text-xs">
					{error}
				</p>
			)}
			{env.length > 0 && (
				<ul className="flex flex-wrap gap-1" aria-label={t("mcp.envLabel")}>
					{env.map((variable) => (
						<Badge key={variable.name} variant="outline" render={<li />}>
							<span className="font-mono">{variable.name}</span>
							<button
								type="button"
								onClick={() => onChange(removeEnvVariable(env, variable.name))}
								aria-label={t("mcp.removeEnv", { name: variable.name })}
								className="hover:text-destructive -mr-0.5 ml-1 rounded-full"
							>
								<X className="size-3" />
							</button>
						</Badge>
					))}
				</ul>
			)}
			<p className="text-muted-foreground text-xs">
				{t("mcp.envCount", { used: env.length, limit: MCP_ENV_VARIABLE_LIMIT })}
			</p>
		</div>
	)
}
