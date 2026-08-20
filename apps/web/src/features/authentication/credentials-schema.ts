import { LoginBody } from "@/api/generated/models/identity/loginBody.zod.ts"
import { BootstrapAdminBody } from "@/api/generated/models/roles/bootstrapAdminBody.zod.ts"
import { RedeemInvitationBody } from "@/api/generated/models/roles/redeemInvitationBody.zod.ts"
import {
	PASSWORD_MAX_LENGTH,
	PASSWORD_MIN_LENGTH,
	USERNAME_MAX_LENGTH,
	USERNAME_MIN_LENGTH,
	USERNAME_PATTERN,
} from "@talqo/shared"
import { z } from "zod"

const usernameSchema = z.string().min(USERNAME_MIN_LENGTH).max(USERNAME_MAX_LENGTH).regex(USERNAME_PATTERN)
const passwordSchema = z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH)

export const credentialsFormSchema = LoginBody.safeExtend({
	username: usernameSchema,
	password: passwordSchema,
}).safeExtend({ confirmPassword: z.string().optional() })

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
export type RegistrationFormValues = z.infer<typeof registrationFormSchema>
