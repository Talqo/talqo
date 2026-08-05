import { GlobalRegistrator } from "@happy-dom/global-registrator"

// bun runs test files in one process; the DOM must exist before the widget
// modules load, but registration may happen only once.
if (typeof document === "undefined") {
	GlobalRegistrator.register({ url: "http://localhost/" })
}
