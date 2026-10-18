import { spyOn } from "bun:test"

const databaseUrls = (process.env.TALQO_TEST_DATABASE_URLS ?? "")
	.split(",")
	.map((url) => url.trim())
	.filter((url) => url.length > 0)
const uploadBase = process.env.TALQO_UPLOAD_DIR

if (databaseUrls.length > 0) {
	const workerId = Number(process.env.BUN_TEST_WORKER_ID ?? process.env.JEST_WORKER_ID ?? 0)
	const index = Number.isSafeInteger(workerId) ? Math.abs(workerId) % databaseUrls.length : 0
	process.env.DATABASE_URL = databaseUrls[index]
	if (uploadBase) process.env.TALQO_UPLOAD_DIR = `${uploadBase}/worker-${index}`
}

const MINIMUM_PASSWORD_HASH_MEMORY_KIB = 8
const MINIMUM_PASSWORD_HASH_TIME_COST = 1
const originalPasswordHash = Bun.password.hash.bind(Bun.password)

spyOn(Bun.password, "hash").mockImplementation((password) =>
	originalPasswordHash(password, {
		algorithm: "argon2id",
		memoryCost: MINIMUM_PASSWORD_HASH_MEMORY_KIB,
		timeCost: MINIMUM_PASSWORD_HASH_TIME_COST,
	}),
)
