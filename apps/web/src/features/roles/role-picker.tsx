import type { Role } from "@/api/generated/models/role.zod"
import type { ReactElement } from "react"

import { Checkbox } from "@talqo/ui/components/checkbox"
import { Label } from "@talqo/ui/components/label"
import { useId } from "react"
import { useTranslation } from "react-i18next"

import { holdsAll } from "./role-form"

type RolePickerProps = {
	disabled?: boolean
	heldPermissions: readonly string[]
	onChange: (selected: string[]) => void
	roles: readonly Role[]
	selected: readonly string[]
}

export function RolePicker({
	disabled = false,
	heldPermissions,
	onChange,
	roles,
	selected,
}: RolePickerProps): ReactElement {
	const { t } = useTranslation()
	const prefix = useId()

	return (
		<div className="space-y-2">
			{roles.map((role) => {
				const notHeld = !holdsAll(heldPermissions, role.permissions)
				const id = `${prefix}-${role.id}`
				return (
					<div
						key={role.id}
						className="rounded-item has-data-checked:border-primary/50 has-data-checked:bg-primary/5 flex min-w-0 items-start gap-3 border p-3"
					>
						<Checkbox
							id={id}
							className="mt-0.5"
							checked={selected.includes(role.id)}
							disabled={disabled || notHeld}
							aria-describedby={notHeld ? `${id}-description` : undefined}
							onCheckedChange={() =>
								onChange(
									selected.includes(role.id) ? selected.filter((roleId) => roleId !== role.id) : [...selected, role.id],
								)
							}
						/>
						<div className="min-w-0 flex-1 space-y-1">
							<Label htmlFor={id} className="block" title={role.name}>
								<span className="block truncate leading-5">{role.name}</span>
							</Label>
							{notHeld ? (
								<p id={`${id}-description`} className="text-muted-foreground text-xs">
									{t("users.roleNotYours")}
								</p>
							) : null}
						</div>
					</div>
				)
			})}
		</div>
	)
}
