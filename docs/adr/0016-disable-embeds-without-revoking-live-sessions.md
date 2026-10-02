# 0016: Disable embeds without revoking live sessions

## Status

Accepted (2026-10-02)

## Context

Operators need an off-switch for an installed embed. Bumping `accessVersion` or rotating the embed token would revoke live sessions silently, while a flag enforced only in the dashboard leaves the public chat reachable. The alternatives differ in where the enforcement gate sits and what happens to conversations already underway.

## Decision

Disabling sets `is_disabled` on the embed without bumping `accessVersion`; acceptance rejects new messages with `embed-disabled` (403) inside the existing row-locked embed read, and the public embed config carries the flag.

## Consequences

Live sessions survive a disable and resume on re-enable. Enforcement sits per message at acceptance, so a disable racing a send either wins the row lock or the send went first. Installed embeds learn the state within the public config's 60-second cache window; recovery polling keeps failing until re-enabled.
