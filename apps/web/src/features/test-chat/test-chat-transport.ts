import {
	getCancelTestChatGenerationUrl,
	getGetTestChatSessionUrl,
	getSendTestChatMessageUrl,
} from "@/api/generated/test-chat/test-chat.ts"
import { type ChatTransport, createFetchChatTransport, type FetchChatTransportOptions } from "@talqo/sdk"

const SESSION_COOKIE = { credentials: "include" } as const

/** The SDK's chat state machine over operator routes; the session cookie authorizes, the credential names the chat. */
export function createTestChatTransport(agentId: string, fetch?: FetchChatTransportOptions["fetch"]): ChatTransport {
	const transport = createFetchChatTransport({
		...(fetch ? { fetch } : {}),
		endpoints: {
			session: (input) => ({ path: getGetTestChatSessionUrl(agentId, input.credential), init: SESSION_COOKIE }),
			send: (input) => ({
				path: getSendTestChatMessageUrl(agentId),
				init: SESSION_COOKIE,
				body: { conversationId: input.credential },
			}),
			cancel: (input) => ({
				path: getCancelTestChatGenerationUrl(agentId, input.credential),
				init: SESSION_COOKIE,
			}),
		},
	})
	// No embed means no appearance to load; whether the agent can reply is learned from the first send.
	return { ...transport, loadConfiguration: async () => ({ title: "", appearance: {}, isAvailable: true }) }
}
