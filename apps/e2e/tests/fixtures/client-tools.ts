import { tool, type ToolSet } from "ai"
import { z } from "zod"

export function mountTools(): void {
	const host = window as { TalqoWidget?: { mount(target: string, options: { tools: ToolSet }): void } }
	if (!host.TalqoWidget) throw new Error("The widget bundle did not load")
	host.TalqoWidget.mount("#talqo-widget", {
		tools: {
			readPage: tool({
				description: "Read the host page title",
				inputSchema: z.object({}),
				execute: async (_input, { abortSignal }) => {
					const executions = Number(sessionStorage.getItem("tool-executions") ?? "0") + 1
					sessionStorage.setItem("tool-executions", String(executions))
					if (new URLSearchParams(location.search).has("hold")) {
						await new Promise<never>((_resolve, reject) => {
							abortSignal?.addEventListener("abort", () => reject(new Error("Cancelled")), { once: true })
						})
					}
					const pageText = document.title
					if (!pageText) throw new Error("Host page title is missing")
					return { pageText }
				},
			}),
		},
	})
	document.documentElement.dataset.toolsReady = "true"
}
