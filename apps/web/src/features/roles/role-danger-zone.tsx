import type { Role } from "@/api/generated/models/role.zod"

import { DangerZone, DangerZoneRow } from "@talqo/ui/components/danger-zone"
import { useTranslation } from "react-i18next"

import { DeleteRoleDialog } from "./delete-role-dialog"
import { losesRoleManagement } from "./role-form"

export function RoleDangerZone({
	disabled,
	heldPermissions,
	ownRoles,
	role,
}: {
	disabled: boolean
	heldPermissions: readonly string[]
	ownRoles: readonly Role[]
	role: Role
}) {
	const { t } = useTranslation()

	return (
		<DangerZone title={t("roles.dangerZone")}>
			<DangerZoneRow
				title={t("roles.delete")}
				description={t("roles.dangerDescription")}
				action={
					<DeleteRoleDialog
						role={role}
						disabled={disabled}
						locksOut={losesRoleManagement({
							heldPermissions,
							rolesBefore: ownRoles,
							rolesAfter: ownRoles.filter(({ id }) => id !== role.id),
						})}
					/>
				}
			/>
		</DangerZone>
	)
}
