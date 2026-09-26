# 0015: Enforce embed disabling at acceptance

## Status

Accepted (2026-09-26)

## Context

Operators need to switch an installed widget off. Rotating the embed token or bumping `accessVersion` would revoke live sessions silently, while a disable enforced only in the dashboard leaves the public chat reachable. The widget also needs the state, and only the unauthenticated embed config reaches already-installed snippets.

## Decision

Store `is_disabled` on the embed, expose it in the public embed config, and reject new messages with `embed-disabled` (403) inside the existing row-locked acceptance read without bumping `accessVersion`.

## Consequences

Live sessions survive a disable and resume when the embed is re-enabled; a disable racing acceptance either wins the lock or the acceptance went first. Widgets learn the state within the config cache window. Recovery polling against a disabled embed keeps failing until re-enabled.
