import { BootstrapAdminBody } from "@/api/generated/models/roles/bootstrapAdminBody.zod.ts"
import { RedeemInvitationBody } from "@/api/generated/models/roles/redeemInvitationBody.zod.ts"
import { z } from "zod"

const passwordSchema = BootstrapAdminBody.shape.password

export const credentialsFormSchema = BootstrapAdminBody.safeExtend({ confirmPassword: z.string().optional() })

const passwordConfirmationIssue = { message: "passwordMismatch", path: ["confirmPassword"] }
const passwordsMatch = (values: { confirmPassword: string; password: string }) =>
	values.confirmPassword === values.password

export const registrationFormSchema = BootstrapAdminBody.safeExtend({ confirmPassword: passwordSchema }).refine(
	passwordsMatch,
	passwordConfirmationIssue,
)

export const invitationRegistrationFormSchema = RedeemInvitationBody.omit({ token: true })
	.safeExtend({ confirmPassword: passwordSchema })
	.refine(passwordsMatch, passwordConfirmationIssue)

export type CredentialsFormValues = z.infer<typeof credentialsFormSchema>
