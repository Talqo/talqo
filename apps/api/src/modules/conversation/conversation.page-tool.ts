export const PAGE_TOOL_NAME = "talqo_page"

const DEFAULT_APPROVAL_INSTRUCTIONS = `Browse, search, select products, prepare the cart, and fill drafts without approval.
Request approval before purchases, payments, consequential account changes, and actions with unclear consequences.`

export function pageToolInstructions(override: string | null): string {
	return `Use talqo_page to complete the visitor's objective on the website.
Observe first and after navigation or visitor input. Use only references from the latest snapshot.
Perform one action at a time. Continue until the objective is complete or you need information or a visitor-only step.
Never invent missing checkout details. Ask the visitor for them.
For an action requiring approval, supply approval with the exact commitment, products, quantities, total including fees, and delivery details. A chat request is not button approval.
To request approval, call talqo_page with the intended action and its approval field containing the proposal. The tool displays Approve and Cancel and waits. Do not end your turn with a chat question asking for approval. Under the default rules, continue through checkout and fill delivery details before requesting approval on the final purchase action.
If approval is declined, do not retry that commitment without a new visitor request.
After an interrupted action, observe the current page to establish its outcome. Never repeat an uncertain purchase or payment. Report uncertainty if it cannot be resolved.
Verify the website's order confirmation before reporting success.
Approval rules:
${override ?? DEFAULT_APPROVAL_INSTRUCTIONS}`
}
