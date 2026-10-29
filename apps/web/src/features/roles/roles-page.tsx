import { getListRolesQueryKey, useCreateRole, useListRoles } from "@/api/generated/roles/roles"
import { PageHeader } from "@/components/page-header"
import { ProblemAlert } from "@/components/problem-alert"
import { UsersRolesSwitcher } from "@/components/users-roles-switcher"
import { AccessDenied } from "@/features/permissions/components/access-denied"
import { useAccessError } from "@/features/permissions/use-access-error"
import { nextDefaultName } from "@/lib/default-name"
import { Button } from "@talqo/ui/components/button"
import { Card, CardDescription, CardHeader } from "@talqo/ui/components/card"
import { CardLink } from "@talqo/ui/components/card-link"
import { CardName } from "@talqo/ui/components/card-name"
import { Skeleton } from "@talqo/ui/components/skeleton"
import { useQueryClient } from "@tanstack/react-query"
import { Link, useNavigate } from "@tanstack/react-router"
import { Plus } from "lucide-react"
import { useTranslation } from "react-i18next"

function RolesSkeleton({ label }: { label: string }) {
	return (
		<div className="space-y-3">
			<output className="sr-only">{label}</output>
			{Array.from({ length: 3 }, (_, index) => (
				<Card key={index}>
					<CardHeader>
						<Skeleton className="h-5 w-40 max-w-full" />
						<Skeleton className="h-4 w-24" />
					</CardHeader>
				</Card>
			))}
		</div>
	)
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
				await navigate({ to: "/dashboard/users/roles/$roleId", params: { roleId: data.role.id } })
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
						<Button onClick={onCreate} disabled={createRole.isPending}>
							<Plus className="size-4" />
							{createRole.isPending ? t("roles.creating") : t("roles.create")}
						</Button>
					) : null
				}
			/>
			<UsersRolesSwitcher />
			{!forbidden ? <ProblemAlert error={createRole.error} /> : null}
			{forbidden ? (
				<AccessDenied />
			) : rolesQuery.isPending ? (
				<RolesSkeleton label={t("roles.loading")} />
			) : rolesQuery.isError || !roles ? (
				<ProblemAlert error={rolesQuery.error} onRetry={() => void rolesQuery.refetch()} />
			) : roles.length === 0 ? (
				<p className="text-muted-foreground">{t("roles.empty")}</p>
			) : (
				<div className="space-y-3">
					{roles.map((role) => (
						<Card key={role.id} variant="interactive" className="relative">
							<CardHeader>
								<CardName>{role.name}</CardName>
								<CardDescription>{t("roles.members", { people: role.memberCount })}</CardDescription>
							</CardHeader>
							<CardLink
								render={
									<Link to="/dashboard/users/roles/$roleId" params={{ roleId: role.id }} data-role-id={role.id} />
								}
								aria-label={role.name}
							/>
						</Card>
					))}
				</div>
			)}
		</div>
	)
}
