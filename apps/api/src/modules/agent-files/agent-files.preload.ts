import { join } from "node:path"

// Resolve before @/config/env.ts is first imported: its TALQO_UPLOAD_DIR is read once and
// cached, so the upload dir must be fixed here, ahead of any module that touches it.
// Keeps test artifacts out of the repo's dev upload dir.
process.env.TALQO_UPLOAD_DIR = join(import.meta.dir, ".test-uploads")
