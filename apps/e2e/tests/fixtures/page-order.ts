type Message = { role: string; content: unknown }
type Observation = { snapshot: string; content: string }

export function orderAction(messages: Message[]): { input?: unknown; answer?: string } {
	const last = messages.at(-1)
	if (last?.role !== "tool") return { input: { action: "observe" } }
	if (typeof last.content !== "string") throw new Error("Expected a serialized page result")
	const result = JSON.parse(last.content) as { status?: string; page?: Observation } & Partial<Observation>
	if (result.status === "declined") return { answer: "The order was not placed." }
	if (result.status === "interrupted") return { input: { action: "observe" } }
	const page = result.page ?? result
	if (!page.content || !page.snapshot) throw new Error(`Missing page observation: ${last.content}`)
	const index = (match: string) => {
		const line = page.content?.split("\n").find((entry) => entry.includes(match) && /\[\d+\]/.test(entry))
		const number = line?.match(/\[(\d+)\]/)?.[1]
		if (!number) throw new Error(`No page control: ${match}\n${page.content}`)
		return Number(number)
	}
	const action = (match: string, description: string, fields: Record<string, unknown> = {}) => ({
		input: {
			action: "click",
			snapshot: page.snapshot,
			index: index(match),
			description,
			approval: null,
			...fields,
		},
	})
	if (page.content.includes("Order confirmed")) return { answer: "Your order is confirmed." }
	if (page.content.includes("Place order")) {
		const express = page.content.includes("Delivery: Express")
		return action("Place order", "Placing your order", {
			approval: `Buy 2 Large Everyday T-shirts for $${express ? "58" : "53"}.00 including ${express ? "Express" : "Standard"} delivery to Alex Example, 12 Market Street.`,
		})
	}
	if (page.content.includes("Review order")) {
		if (
			!messages.some(
				(message) =>
					message.role === "user" &&
					typeof message.content === "string" &&
					message.content.includes("12 Market Street"),
			)
		)
			return { answer: "What full name and delivery address should I use?" }
		if (!page.content.includes('value="Alex Example"') && !page.content.includes("value=Alex Example"))
			return action("name=name", "Entering your full name", { action: "fill", text: "Alex Example" })
		if (!page.content.includes("12 Market Street"))
			return action("name=address", "Entering your delivery address", { action: "fill", text: "12 Market Street" })
		return action("Review order", "Reviewing your order")
	}
	if (page.content.includes("Go to checkout")) {
		if (!page.content.includes("value=2") && !page.content.includes('value="2"'))
			return action("name=quantity", "Setting the quantity to two", { action: "fill", text: "2" })
		// The summary proves the cart update was submitted, not just typed.
		if (page.content.includes("quantity 1")) return action("Update cart", "Updating your cart")
		return action("Go to checkout", "Opening checkout")
	}
	if (page.content.includes("Add to cart")) {
		if (!page.content.includes("value=Large") && !page.content.includes('value="Large"'))
			return action("name=size", "Selecting size Large", { action: "select", option: "Large" })
		return action("Add to cart", "Adding the T-shirts to your cart")
	}
	return action("View Everyday T-shirt", "Opening the Everyday T-shirt")
}
