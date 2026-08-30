import { join } from "node:path"

// Must run before @/config/env.ts caches TALQO_UPLOAD_DIR.
process.env.TALQO_UPLOAD_DIR = join(import.meta.dir, ".test-uploads")
