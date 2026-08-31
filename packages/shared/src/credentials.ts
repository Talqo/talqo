export const USERNAME_MIN_LENGTH = 3
export const USERNAME_MAX_LENGTH = 32
export const USERNAME_PATTERN = /^[a-zA-Z0-9_-]+$/
export const PASSWORD_MIN_LENGTH = 8
// Byte cap (measured as UTF-8 bytes), not a char cap: string.length counts UTF-16 units, so a
// char-limit lets multi-byte input sail past argon2/bcrypt's ~72-byte secret limit.
export const PASSWORD_MAX_LENGTH = 72
// Cap for secrets the server hashes or compares but does not store (tokens, API keys, current passwords).
export const CREDENTIAL_MAX_LENGTH = 128
