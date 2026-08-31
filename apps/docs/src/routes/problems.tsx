import { createFileRoute } from "@tanstack/react-router"

type ProblemDefinition = {
	code: string
	guidance: string
	meaning: string
	status: string
	title: string
}

const PROBLEMS = [
	{
		code: "admin-access-required",
		title: "Admin access required",
		status: "403",
		meaning: "The operation requires an administrator.",
		guidance: "Use an administrator account.",
	},
	{
		code: "admin-already-exists",
		title: "Admin already exists",
		status: "409",
		meaning: "Initial setup has already created an administrator.",
		guidance: "Log in instead of repeating setup.",
	},
	{
		code: "agent-invalid",
		title: "Invalid agent",
		status: "400",
		meaning: "The agent configuration violates a domain constraint.",
		guidance: "Correct the submitted agent fields.",
	},
	{
		code: "agent-name-taken",
		title: "Agent name already in use",
		status: "409",
		meaning: "Another agent uses the submitted name.",
		guidance: "Choose a unique name.",
	},
	{
		code: "agent-not-found",
		title: "Agent not found",
		status: "404",
		meaning: "The requested agent does not exist.",
		guidance: "Refresh the agent list and use an existing ID.",
	},
	{
		code: "authentication-required",
		title: "Authentication required",
		status: "401",
		meaning: "The request has no valid Talqo session.",
		guidance: "Log in and retry.",
	},
	{
		code: "configuration-conflict",
		title: "Configuration conflict",
		status: "409",
		meaning: "The AI provider configuration changed since it was read.",
		guidance: "Reload the configuration and retry the change.",
	},
	{
		code: "current-password-incorrect",
		title: "Current password incorrect",
		status: "400",
		meaning: "The supplied current password is incorrect.",
		guidance: "Enter the current account password.",
	},
	{
		code: "internal-server-error",
		title: "Internal server error",
		status: "500",
		meaning: "Talqo encountered an unexpected server error.",
		guidance: "Retry later and inspect server logs if it persists.",
	},
	{
		code: "invalid-ai-provider-configuration",
		title: "Invalid AI provider configuration",
		status: "400",
		meaning: "The provider settings or credentials are incomplete or incompatible.",
		guidance: "Correct the provider configuration.",
	},
	{
		code: "invalid-credentials",
		title: "Invalid credentials",
		status: "401",
		meaning: "The Talqo username or password is incorrect.",
		guidance: "Check the credentials and retry.",
	},
	{
		code: "invalid-invitation",
		title: "Invalid invitation",
		status: "409",
		meaning: "The invitation is invalid, expired, or already used.",
		guidance: "Request a new invitation.",
	},
	{
		code: "invalid-request",
		title: "Invalid request",
		status: "400",
		meaning: "The request does not satisfy the endpoint contract.",
		guidance: "Correct the request using the OpenAPI schema.",
	},
	{
		code: "malformed-json",
		title: "Malformed JSON",
		status: "400",
		meaning: "The request body is not valid JSON.",
		guidance: "Send a syntactically valid JSON body.",
	},
	{
		code: "model-discovery-unsupported",
		title: "Model discovery unsupported",
		status: "502",
		meaning: "The selected provider configuration cannot discover models.",
		guidance: "Enter a model manually or change the provider configuration.",
	},
	{
		code: "password-change-not-required",
		title: "Password change not required",
		status: "409",
		meaning: "The account is not awaiting a forced password change.",
		guidance: "Use the normal account password flow.",
	},
	{
		code: "password-change-required",
		title: "Password change required",
		status: "403",
		meaning: "The account must change its password before other API operations.",
		guidance: "Complete the forced password change.",
	},
	{
		code: "permission-denied",
		title: "Permission denied",
		status: "403",
		meaning: "The account lacks the permission required by the operation.",
		guidance: "Ask an administrator to grant access.",
	},
	{
		code: "provider-credentials-rejected",
		title: "Provider credentials rejected",
		status: "400",
		meaning: "The external AI provider rejected the credentials.",
		guidance: "Correct the provider credentials.",
	},
	{
		code: "provider-error",
		title: "Provider error",
		status: "502",
		meaning: "The external AI provider returned an unusable response.",
		guidance: "Verify provider settings or retry later.",
	},
	{
		code: "provider-rate-limited",
		title: "Provider rate limited",
		status: "429",
		meaning: "The external AI provider rate limit was reached.",
		guidance: "Wait before retrying.",
	},
	{
		code: "provider-unreachable",
		title: "Provider unreachable",
		status: "502",
		meaning: "Talqo could not reach the external AI provider.",
		guidance: "Verify network and provider endpoint settings.",
	},
	{
		code: "request-failed",
		title: "Request failed",
		status: "Original 4xx or 5xx",
		meaning: "A response-carrying error had no recognized Talqo problem body.",
		guidance: "Use the HTTP status and retry or correct the request.",
	},
	{
		code: "route-not-found",
		title: "Route not found",
		status: "404",
		meaning: "The requested API route does not exist.",
		guidance: "Correct the method or URL using the OpenAPI contract.",
	},
	{
		code: "self-password-reset-not-allowed",
		title: "Self password reset not allowed",
		status: "400",
		meaning: "An administrator attempted to use the user-reset flow on their own account.",
		guidance: "Use account settings to change the current account password.",
	},
	{
		code: "user-not-found",
		title: "User not found",
		status: "404",
		meaning: "The requested user does not exist.",
		guidance: "Refresh the user list and use an existing ID.",
	},
	{
		code: "username-taken",
		title: "Username already in use",
		status: "409",
		meaning: "Another account uses the submitted username.",
		guidance: "Choose a unique username.",
	},
] satisfies readonly ProblemDefinition[]

export const Route = createFileRoute("/problems")({
	component: ProblemsPage,
})

function ProblemsPage() {
	return (
		<main className="mx-auto max-w-3xl px-6 py-12">
			<h1 className="text-3xl font-semibold">API problem types</h1>
			<p className="text-fd-muted-foreground mt-3">
				Talqo API errors use RFC 9457 problem details. The type URI is the primary identifier; the code is a stable
				localization key.
			</p>
			<div className="mt-10 space-y-10">
				{PROBLEMS.map((problem) => (
					<section id={problem.code} key={problem.code} className="scroll-mt-6 border-t pt-6">
						<h2 className="text-xl font-semibold">{problem.title}</h2>
						<code className="mt-2 block text-sm">{problem.code}</code>
						<p className="mt-3">{problem.meaning}</p>
						<p className="mt-2">
							<strong>Status:</strong> {problem.status}
						</p>
						<p className="mt-2">
							<strong>Resolution:</strong> {problem.guidance}
						</p>
						<p className="mt-2 text-sm break-all">
							<strong>Type:</strong> https://docs.talqo.chat/problems#{problem.code}
						</p>
					</section>
				))}
			</div>
		</main>
	)
}
