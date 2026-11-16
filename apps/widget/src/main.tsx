import { mount, unmount } from "./chat"
import { widgetGlobals } from "./lib/chat-bridge"

widgetGlobals().talqoDevChat = { mount, unmount }
void import("./widget")
// The development shop mounts into the host page beside the widget.
void import("./dev-shop")
