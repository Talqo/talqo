import { mount, unmount } from "./chat"
import { widgetGlobals } from "./lib/chat-bridge"

widgetGlobals().talqoDevChat = { mount, unmount }
void import("./widget")
