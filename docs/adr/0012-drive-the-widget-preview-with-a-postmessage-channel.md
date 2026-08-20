# 0012: Drive The Widget Preview With A postMessage Channel

## Status

Accepted (2026-08-19)

## Context

The dashboard previews the widget by embedding the real bundle in an iframe, which keeps the preview honest and the widget's CSS isolated. Carrying appearance in the iframe URL reloaded the frame on every keystroke, needing a debounce and still flickering. Re-implementing the UI dashboard-side would drift from what customers see, and apps may not import each other.

## Decision

Keep URL parameters for the iframe's initial paint and send later appearance changes over a versioned `talqo-preview` `postMessage` channel, with the child announcing readiness and both sides pinning an explicit `targetOrigin`.

## Consequences

The preview updates continuously with no reload or debounce, and reload, HMR, and bfcache restore re-sync from the next handshake. Both apps declare the message shape independently, so the wire format is the contract. The dashboard must echo its origin into the iframe URL, since E2E serves the apps on different hostnames.
