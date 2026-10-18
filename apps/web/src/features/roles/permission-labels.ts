import type { Role } from "@/api/generated/models/role.zod"

export type GrantablePermission = Role["permissions"][number]

type Translate = (key: string) => string
type PermissionCopy = { description: (t: Translate) => string; label: (t: Translate) => string }

// Literal keys keep i18next-cli aware of every label; permission strings never reach the UI.
export const PERMISSION_COPY: Record<GrantablePermission, PermissionCopy> = {
	"users:read": {
		label: (t) => t("roles.permissionLabels.usersRead"),
		description: (t) => t("roles.permissionDescriptions.usersRead"),
	},
	"users:manage": {
		label: (t) => t("roles.permissionLabels.usersManage"),
		description: (t) => t("roles.permissionDescriptions.usersManage"),
	},
	"roles:manage": {
		label: (t) => t("roles.permissionLabels.rolesManage"),
		description: (t) => t("roles.permissionDescriptions.rolesManage"),
	},
	"ai_provider:manage": {
		label: (t) => t("roles.permissionLabels.aiProviderManage"),
		description: (t) => t("roles.permissionDescriptions.aiProviderManage"),
	},
	"agents:read": {
		label: (t) => t("roles.permissionLabels.agentsRead"),
		description: (t) => t("roles.permissionDescriptions.agentsRead"),
	},
	"agents:manage": {
		label: (t) => t("roles.permissionLabels.agentsManage"),
		description: (t) => t("roles.permissionDescriptions.agentsManage"),
	},
}
