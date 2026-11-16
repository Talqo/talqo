import { createChatClient } from "@talqo/sdk"

const params = new URLSearchParams(location.search)
const apiUrl = params.get("api")
const embedToken = params.get("token")
if (!apiUrl || !embedToken) throw new Error("SDK fixture needs an API and embed token")
const root = document.createElement("div")
root.innerHTML = `<form aria-label="Custom chat"><label>Message <input name="message" required></label><button>Send message</button></form><output aria-label="Reply"></output>`
document.body.append(root)
const client = createChatClient({ apiUrl, embedToken, pageControl: { exclude: [root] } })
const output = root.querySelector("output")
client.subscribe(() => {
	const snapshot = client.getSnapshot()
	if (output) output.textContent = snapshot.messages.at(-1)?.text ?? ""
})
await client.initialize()
root.querySelector("form")?.addEventListener("submit", (event) => {
	event.preventDefault()
	if (!(event.target instanceof HTMLFormElement)) return
	const message = new FormData(event.target).get("message")
	if (typeof message !== "string") throw new Error("Missing message")
	void client.sendMessage(message)
})
