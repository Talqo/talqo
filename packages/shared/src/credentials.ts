export const USERNAME_MIN_LENGTH = 3
export const USERNAME_MAX_LENGTH = 32
export const USERNAME_PATTERN = /^[a-zA-Z0-9_-]+$/
export const PASSWORD_MIN_LENGTH = 8
export const PASSWORD_MAX_LENGTH = 128
// Cap for secrets the server hashes before verifying but never stores (passwords, invitation tokens).
// Stored secrets such as AI-provider API keys use the larger bound in the ai-provider contract.
export const CREDENTIAL_MAX_LENGTH = 128
