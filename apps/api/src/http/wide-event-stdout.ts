import { createWideEventLog } from "@/http/wide-event-log.ts"
import pino from "pino"

const MAX_BUFFERED_BYTES = 1_048_576

// Async and capped: a slow stdout drops lines rather than blocking requests or growing memory.
export const stdoutWideEventLog = createWideEventLog(
	pino.destination({ dest: 1, sync: false, maxLength: MAX_BUFFERED_BYTES }),
)
