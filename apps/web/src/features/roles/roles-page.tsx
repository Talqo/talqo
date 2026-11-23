import type { Role } from "@/api/generated/models/role.zod"

import { getListRolesQueryKey, useCreateRole, useListRoles } from "@/api/generated/roles/roles"
import { FloatingActionButton } from "@/components/floating-action-button"
import { PageHeader } from "@/components/page-header"
import { SkeletonList } from "@/components/page-skeleton"
import { ProblemAlert } from "@/components/problem-alert"
import { AccessDenied } from "@/features/permissions/components/access-denied"
import { useAccessError } from "@/features/permissions/use-access-error"
import { TeamRolesSwitcher } from "@/features/team/team-roles-switcher"
import { nextDefaultName } from "@/lib/default-name"
import { Card, CardDescription, CardHeader } from "@talqo/ui/components/card"
import { CardLink } from "@talqo/ui/components/card-link"
import { CardName } from "@talqo/ui/components/card-name"
import { EmptyState } from "@talqo/ui/components/empty-state"
import { Skeleton } from "@talqo/ui/components/skeleton"
import { useQueryClient } from "@tanstack/react-query"
import { Link, useNavigate } from "@tanstack/react-router"
import { Plus, ShieldCheck } from "lucide-react"
import { useTranslation } from "react-i18next"

type RolesQuery = {
	data?: { data: { roles: Array<Role> } }
	error: unknown
	isError: boolean
	isPending: boolean
	refetch: () => unknown
}

function RolesSkeleton({ label }: { label: string }) {
	return (
		<SkeletonList label={label}>
			<CardHeader>
				<Skeleton className="h-5 w-40 max-w-full" />
				<Skeleton className="h-4 w-24" />
			</CardHeader>
		</SkeletonList>
	)
}

function CreateRoleButton({ onCreate, pending }: { onCreate: () => void; pending: boolean }) {
	const { t } = useTranslation()
	return (
		<FloatingActionButton onClick={onCreate} disabled={pending}>
			<Plus />
			{pending ? t("roles.creating") : t("roles.create")}
		</FloatingActionButton>
	)
}

function RoleCards({ roles }: { roles: ReadonlyArray<Role> }) {
	const { t } = useTranslation()
	return (
		<div className="space-y-3">
			{roles.map((role) => (
				<Card key={role.id} variant="interactive" className="relative">
					<CardHeader>
						<CardName>{role.name}</CardName>
						<CardDescription>{t("roles.members", { people: role.memberCount })}</CardDescription>
					</CardHeader>
					<CardLink
						render={<Link to="/dashboard/team/roles/$roleId" params={{ roleId: role.id }} data-role-id={role.id} />}
						aria-label={role.name}
					/>
				</Card>
			))}
		</div>
	)
}

function RolesBody({
	creating,
	forbidden,
	onCreate,
	query,
}: {
	creating: boolean
	forbidden: boolean
	onCreate: () => void
	query: RolesQuery
}) {
	const { t } = useTranslation()
	if (forbidden) return <AccessDenied />
	if (query.isPending) return <RolesSkeleton label={t("roles.loading")} />
	if (query.isError || !query.data) return <ProblemAlert error={query.error} onRetry={() => void query.refetch()} />
	const roles = query.data.data.roles
	if (roles.length === 0)
		return (
			<EmptyState
				icon={ShieldCheck}
				title={t("roles.emptyTitle")}
				description={t("roles.emptyDescription")}
				actions={<CreateRoleButton onCreate={onCreate} pending={creating} />}
			/>
		)
	return <RoleCards roles={roles} />
}

export function RolesPage() {
	const { t } = useTranslation()
	const navigate = useNavigate()
	const queryClient = useQueryClient()
	const rolesQuery = useListRoles()
	const createRole = useCreateRole({
		mutation: {
			onSuccess: async ({ data }) => {
				await queryClient.invalidateQueries({ queryKey: getListRolesQueryKey() })
				await navigate({ to: "/dashboard/team/roles/$roleId", params: { roleId: data.role.id } })
			},
			onError: (error) => {
				// A taken name means the cached list is stale; refresh it so Retry proposes a free one.
				if (error.info?.code === "role-name-taken") void rolesQuery.refetch()
			},
		},
	})
	const forbidden = useAccessError(rolesQuery.error, createRole.error)
	const roles = rolesQuery.data?.data.roles

	function onCreate() {
		if (!roles || createRole.isPending) return
		createRole.mutate({
			data: {
				name: nextDefaultName(
					roles.map(({ name }) => name),
					t("roles.defaultName"),
				),
				permissions: [],
			},
		})
	}

	return (
		<div className="space-y-6">
			<PageHeader
				title={t("roles.heading")}
				description={t("roles.subheading")}
				actions={
					roles && !rolesQuery.isError && !forbidden ? (
						<CreateRoleButton onCreate={onCreate} pending={createRole.isPending} />
					) : null
				}
			/>
			<TeamRolesSwitcher />
			{!forbidden ? <ProblemAlert error={createRole.error} onRetry={onCreate} /> : null}
			<RolesBody creating={createRole.isPending} forbidden={forbidden} onCreate={onCreate} query={rolesQuery} />
		</div>
	)
}
