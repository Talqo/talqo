import { z } from "zod"

const MAX_QUANTITY = 10
const PRICE = 25
const STANDARD_DELIVERY = 3
const EXPRESS_DELIVERY = 8
const CURRENCY_DECIMALS = 2
const checkoutSchema = z.object({
	size: z.enum(["Small", "Medium", "Large"]).default("Medium"),
	quantity: z.number().int().min(0).max(MAX_QUANTITY).default(0),
	name: z.string().default(""),
	address: z.string().default(""),
	delivery: z.enum(["Standard", "Express"]).default("Standard"),
})
const stateSchema = checkoutSchema.extend({
	order: checkoutSchema.extend({ id: z.uuid() }).nullable().default(null),
})
const KEY = "talqo-demo-shop"
const state = stateSchema.parse(JSON.parse(sessionStorage.getItem(KEY) ?? "{}"))
const save = () => sessionStorage.setItem(KEY, JSON.stringify(state))
const deliveryPrice = (delivery = state.delivery) => (delivery === "Express" ? EXPRESS_DELIVERY : STANDARD_DELIVERY)
const money = (value: number) => `$${value.toFixed(CURRENCY_DECIMALS)}`
const url = (page: string) => {
	const next = new URL(location.href)
	next.searchParams.set("shop", page)
	return next.href
}
const root = document.createElement("main")
root.id = "demo-shop"
const style = document.createElement("style")
style.textContent = `#demo-shop{font:16px/1.6 system-ui;max-width:760px;margin:40px auto;padding:24px;color:#15202b}
#demo-shop h1{font-size:32px;margin:16px 0}#demo-shop h2{font-size:24px;margin:16px 0}
#demo-shop p,#demo-shop nav{margin:16px 0}#demo-shop label{display:block;margin:12px 0}
#demo-shop input,#demo-shop select,#demo-shop button{font:inherit;padding:10px;border:1px solid #718096;border-radius:6px;background:white;color:#15202b}
#demo-shop button{cursor:pointer}#demo-shop button:disabled{opacity:.5}#demo-shop a{color:#174db2;text-decoration:underline;margin-right:16px}
#demo-shop article{padding:20px;border:1px solid #9ca3af;margin:16px 0;border-radius:12px}
#demo-shop output{display:block;font-weight:600}#demo-shop input{max-width:100%}`
document.head.append(style)
document.body.prepend(root)
root.innerHTML = `<nav><a href="${url("catalog")}">Products</a><a href="${url("cart")}">Cart</a><button id="reset-shop">Reset shop</button></nav>
<p>Demo shop. No real payment or order.</p><div id="shop-page"></div>`
root.querySelector("#reset-shop")?.addEventListener("click", () => {
	sessionStorage.removeItem(KEY)
	location.assign(url("catalog"))
})
const page = root.querySelector("#shop-page")
if (!page) throw new Error("Shop page is missing")
const currentPage = new URL(location.href).searchParams.get("shop") ?? "catalog"
const summary = (
	checkout: z.infer<typeof checkoutSchema> = state,
) => `<p>Everyday T-shirt, ${checkout.size}, quantity ${checkout.quantity}. ${money(PRICE)} each.</p>
<p>Delivery: ${checkout.delivery}, ${money(deliveryPrice(checkout.delivery))}. No additional fees.</p>
<output>Total: ${money(checkout.quantity * PRICE + deliveryPrice(checkout.delivery))}</output>`

if (currentPage === "catalog") {
	page.innerHTML = `<h1>Talqo demo shop</h1><label>Search products <input type="search" id="product-search"></label>
<article data-product="everyday t-shirt"><h2>Everyday T-shirt</h2><p>Soft cotton. ${money(PRICE)}.</p><a href="${url("product")}">View Everyday T-shirt</a></article>
<article data-product="canvas bag"><h2>Canvas bag</h2><p>Unavailable</p><button disabled>Add Canvas bag to cart</button></article>`
	page.querySelector<HTMLInputElement>("#product-search")?.addEventListener("input", (event) => {
		if (!(event.target instanceof HTMLInputElement)) return
		const search = event.target.value.toLowerCase()
		for (const article of page.querySelectorAll<HTMLElement>("article"))
			article.hidden = !article.dataset.product?.includes(search)
	})
} else if (currentPage === "product") {
	page.innerHTML = `<h1>Everyday T-shirt</h1><p>Soft cotton. ${money(PRICE)} each.</p>
<form id="product-form"><label>Size <select name="size"><option>Small</option><option>Medium</option><option>Large</option></select></label>
<label>Quantity <input name="quantity" type="number" min="1" max="10" value="1" required></label><button>Add to cart</button></form>`
	page.querySelector("form")?.addEventListener("submit", (event) => {
		event.preventDefault()
		if (!(event.target instanceof HTMLFormElement)) return
		const form = new FormData(event.target)
		state.size = stateSchema.shape.size.parse(form.get("size"))
		state.quantity = stateSchema.shape.quantity.parse(Number(form.get("quantity")))
		state.order = null
		save()
		location.assign(url("cart"))
	})
} else if (currentPage === "cart") {
	page.innerHTML = `<h1>Cart</h1>${
		state.quantity
			? `${summary()}
<form id="cart-form"><label>Cart quantity <input name="quantity" type="number" min="1" max="10" value="${state.quantity}" required></label>
<button>Update cart</button></form><a href="${url("checkout")}">Go to checkout</a>`
			: `<p>Your cart is empty.</p>`
	}`
	page.querySelector("form")?.addEventListener("submit", (event) => {
		event.preventDefault()
		if (!(event.target instanceof HTMLFormElement)) return
		state.quantity = stateSchema.shape.quantity.parse(Number(new FormData(event.target).get("quantity")))
		state.order = null
		save()
		location.reload()
	})
} else if (currentPage === "checkout" && state.quantity) {
	page.innerHTML = `<h1>Checkout</h1>${summary()}<form>
<label>Full name <input name="name" autocomplete="name" required></label>
<label>Delivery address <input name="address" autocomplete="street-address" required></label>
<label>Delivery <select name="delivery"><option>Standard</option><option>Express</option></select></label>
<button>Review order</button></form>`
	for (const input of page.querySelectorAll<HTMLInputElement>("input"))
		input.value = input.name === "name" ? state.name : state.address
	page.querySelector("form")?.addEventListener("submit", (event) => {
		event.preventDefault()
		if (!(event.target instanceof HTMLFormElement)) return
		const form = new FormData(event.target)
		state.name = z.string().parse(form.get("name"))
		state.address = z.string().parse(form.get("address"))
		state.delivery = stateSchema.shape.delivery.parse(form.get("delivery"))
		save()
		location.assign(url("review"))
	})
} else if (currentPage === "review" && state.quantity && state.name && state.address) {
	page.innerHTML = `<h1>Review order</h1><div id="order-summary">${summary()}</div><p id="recipient"></p>
<label>Delivery <select id="review-delivery"><option>Standard</option><option>Express</option></select></label>
<button id="place-order">Place order</button>`
	const recipient = page.querySelector("#recipient")
	if (recipient) recipient.textContent = `Deliver to ${state.name}, ${state.address}`
	const delivery = page.querySelector<HTMLSelectElement>("#review-delivery")
	if (delivery) {
		delivery.value = state.delivery
		delivery.addEventListener("change", () => {
			state.delivery = stateSchema.shape.delivery.parse(delivery.value)
			save()
			const orderSummary = page.querySelector("#order-summary")
			if (orderSummary) orderSummary.innerHTML = summary()
		})
	}
	page.querySelector("#place-order")?.addEventListener("click", () => {
		state.order ??= { id: crypto.randomUUID(), ...checkoutSchema.parse(state) }
		save()
		location.assign(url("confirmation"))
	})
} else if (currentPage === "confirmation" && state.order) {
	page.innerHTML = `<h1>Order confirmed</h1>${summary(state.order)}<p id="order-number"></p><p id="recipient"></p>`
	const number = page.querySelector("#order-number")
	const recipient = page.querySelector("#recipient")
	if (number) number.textContent = `Order number: ${state.order.id}`
	if (recipient) recipient.textContent = `Deliver to ${state.order.name}, ${state.order.address}`
} else page.innerHTML = `<h1>No order to show</h1><a href="${url("catalog")}">Browse products</a>`
