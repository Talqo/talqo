import { mountWidget } from "./widget"

const root = document.querySelector("#root")

if (!root) {
	throw new Error("Root element not found")
}

mountWidget(root)
