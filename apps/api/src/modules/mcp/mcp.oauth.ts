import type { CredentialEnvelope, createCredentialVault } from "@/lib/credential-vault.ts"
import type { OAuthClientInformation, OAuthClientProvider, OAuthTokens } from "@ai-sdk/mcp"

import type { McpServerRow } from "./mcp.schema.ts"
import type { McpServerPatch } from "./mcp.schema.ts"

import { OAUTH_STATE_TTL_MS } from "./mcp.types.ts"

type Vault = ReturnType<typeof createCredentialVault>

export type OAuthRow = Pick<
	McpServerRow,
	"id" | "oauthClient" | "oauthPending" | "oauthStateExpiresAt" | "oauthTokens" | "url"
>

/** Half-finished state; discarded on completion or expiry so a stalled attempt leaves nothing behind. */
type Pending = { codeVerifier: string; state: string }

export class AuthorizationServerChangedError extends Error {}

export function createOAuthProvider(options: {
	/** Set by the authorize route: the client throws instead of following a cross-origin redirect. */
	onAuthorizationUrl: (url: URL) => Promise<void>
	redirectUrl: string
	row: OAuthRow
	vault: Vault
	write: (patch: McpServerPatch) => Promise<void>
}): OAuthClientProvider {
	const { row, vault, write } = options
	const context = { serverId: row.id }
	const read = <T>(envelope: CredentialEnvelope | null): T | undefined =>
		envelope ? vault.decrypt<T>(envelope, context) : undefined
	const readPending = (): Pending => read<Pending>(row.oauthPending) ?? { codeVerifier: "", state: "" }
	const savePending = async (next: Partial<Pending>) => {
		await write({
			oauthPending: vault.encrypt({ ...readPending(), ...next }, context),
			oauthStateExpiresAt: new Date(Date.now() + OAUTH_STATE_TTL_MS),
		})
	}

	return {
		get redirectUrl() {
			return options.redirectUrl
		},
		get clientMetadata() {
			return {
				client_name: "Talqo",
				redirect_uris: [options.redirectUrl],
				grant_types: ["authorization_code", "refresh_token"],
				response_types: ["code"],
				token_endpoint_auth_method: "none",
			}
		},
		tokens: () => read<OAuthTokens>(row.oauthTokens),
		async saveTokens(tokens) {
			await write({ oauthTokens: vault.encrypt(tokens, context), oauthPending: null, oauthStateExpiresAt: null })
		},
		async invalidateCredentials() {
			await write({ oauthTokens: null })
		},
		clientInformation: () => read<OAuthClientInformation>(row.oauthClient),
		async saveClientInformation(clientInformation) {
			const confirmed = read<OAuthClientInformation>(row.oauthClient)?.issuer
			const issuer = clientInformation.issuer ?? confirmed
			// An issuer change is not a detail: sending stored tokens to a new one is the attack this blocks.
			if (confirmed && issuer && confirmed !== issuer) {
				await write({ oauthTokens: null, oauthClient: null })
				throw new AuthorizationServerChangedError(confirmed)
			}
			await write({ oauthClient: vault.encrypt({ ...clientInformation, issuer }, context) })
		},
		codeVerifier: () => readPending().codeVerifier,
		saveCodeVerifier: (codeVerifier) => savePending({ codeVerifier }),
		state: () => readPending().state,
		saveState: (state) => savePending({ state: state || crypto.randomUUID() }),
		storedState: () => {
			if (!row.oauthPending || !row.oauthStateExpiresAt) return undefined
			if (row.oauthStateExpiresAt.getTime() < Date.now()) return undefined
			return readPending().state
		},
		async redirectToAuthorization(url) {
			await options.onAuthorizationUrl(url)
		},
	}
}
