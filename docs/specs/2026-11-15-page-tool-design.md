# Autonomous ordering through the page tool

## Status

Approved.

## Goal

A visitor can request a purchase and have the agent complete the order. The visitor supplies missing information and explicitly approves consequential actions, but does not have to drive checkout.

Use a built-in SDK tool backed by `@talqo/page-controller`. Keep the agent's actions visible on the host page and leave chat presentation unchanged.

## Purchase journey

1. Find the requested product and select the requested options and quantity.
2. Add it to the cart and navigate through checkout.
3. Use information available from the request, conversation, and checkout. Ask for missing details instead of inventing them.
4. Show the proposed order, total including delivery and fees, and delivery details for approval before committing the purchase.
5. Place the approved order and verify the website's confirmation before reporting success.

Continue automatically across same-origin pages in the same tab, including full page loads. Talqo must be installed on the destination pages. The visitor must not have to repeat the purchase request or ask the agent to continue after each navigation.

For a visitor-only step, such as a CAPTCHA, payment authentication, or an external checkout, explain what the visitor must do. Reobserve the page before continuing after their response. Do not bypass browser or payment controls.

## Page tool

- Provide observation, clicking, filling, option selection, and scrolling through one built-in client tool. Use compact semantic page context rather than screenshots or raw HTML.
- Return current form values, selected options, accessible names, and the observed result of each action. Return a fresh observation with action results when the document remains available.
- Validate captured targets before acting. A stale, detached, disabled, or covered control must not cause a different action or a false success report.
- Reobserve after navigation or visitor edits. A dispatched click alone is not evidence that an order was placed.
- Register the tool automatically for enabled embeds in both the widget and custom SDK UIs. Exclude chat and tool-owned controls from observation and targeting.
- Keep the eight-tool total limit, including this built-in. Report collisions or excess tools explicitly without dropping custom tools.

Verify the current stable PageController release before adding it. Correct its live-state and target-validation defects through an upstream fix or a small reproducible dependency correction. If this requires a substantial fork, request a decision before expanding the implementation.

## Visible actions and approvals

The tool scrolls the active control into view and highlights it before acting. Show a style-isolated on-page panel only while awaiting approval. Chat displays tool activity and provides Stop without blocking ordinary page interaction.

Browsing, product selection, cart preparation, and draft form filling proceed without approval by default. Purchases, payments, consequential account changes, and unclear commitments require approval. Operators can customize these rules per agent through plain-language instructions; the model interprets them.

Show Approve and Cancel for the exact proposed commitment. A purchase request in chat does not replace the approval button. Approval authorizes only that action. Recheck the target and material order details before execution; a changed product, quantity, price, fee, or delivery choice requires fresh approval.

Cancel performs no proposed action. Stop prevents further actions and cancels the active task; it cannot undo an action already dispatched. An expired, interrupted, or invalidated approval cannot execute later. If an action's outcome is uncertain, inspect the current website state rather than replaying it. If the outcome cannot be established, tell the visitor instead of risking a duplicate order.

Support keyboard operation, visible focus, accessible approval announcements, reduced motion, and the configured embed language. Keep approval controls in the tool, not in chat components.

## Operator settings and integration

Website actions belong to the agent's Tools tab, separately from connected tools. One switch, enabled by default, applies to every embed using that agent. Approval instructions are prefilled editable content, with Restore defaults and Save actions. Hide the instructions when disabled without discarding them. Save through agent settings and permissions; omitted fields in older update callers preserve saved settings. Embed appearance has no website-action controls.

The API supplies the agent's instructions to the model and prevents its disabled website tool from being invoked, including through a stale browser manifest. Disabling website actions must not disable unrelated custom tools.

The SDK owns browser execution, tool-owned UI, and cleanup. The conversation module owns task continuity and recorded execution outcomes. Preserve the purchase objective and completed action outcomes across page navigation and requests for visitor input.

Adapt connection-bound execution and the model-step budget only as needed to complete the journey. Keep execution bounded and cancellable, preserve existing conversation authorization and usage accounting, and never implement continuation by blindly resubmitting the original purchase request or replaying completed actions.

Generate both API clients for contract changes and use one generated migration for embed settings. Preserve custom-tool validation, host-page style isolation, and the non-executing dashboard appearance preview.

## Widget development shop

Add a simulated shop to the widget dev app with searchable products, product options, cart updates, checkout validation, order review, and a confirmed simulated order.

Use real controls and separate same-origin pages with full page navigation. Carry the cart and simulated orders across those page loads. Include a way to reset the shop, an unavailable product, and an order change that invalidates approval.

Keep checkout local and simulated, without a payment provider or commerce backend. Exclude all demo-shop code from the production widget bundle.

## Complete when

- [x] From one purchase request, the agent finds the requested product, selects its options, updates the cart, navigates through checkout, obtains approval, places one simulated order, and verifies confirmation. The visitor only supplies missing details, handles visitor-only steps, and approves commitments.
- [x] That journey succeeds across full page loads without repeated purchase requests or manual step-by-step guidance. The confirmed order matches the approved products, quantities, delivery details, and total.
- [x] The visitor can see the agent's actions and stop it. Once the agent requests approval, cancellation, changed order details, and interrupted approval prevent the pending commitment. Navigation or reconnection does not replay the dispatched action.
- [x] The same page-tool behavior works through the widget and a custom SDK UI. Operator enablement and approval instructions work, disabled embeds cannot invoke the tool, and chat presentation remains unchanged.
- [x] Real-browser regression coverage protects live form state, invalid targets, approval revalidation, cancellation, and navigation continuity. Deterministic end-to-end tests use the real SDK, API, and database; a demonstration with a configured real model establishes autonomous completion rather than only scripted tool execution.
- [x] Production builds exclude the demo shop, disposal removes tool-owned resources, generated clients match the API, the migration applies, and the applicable repository checks pass.

Run the applicable implementation gates: `quality:fix`, `duplication`, `typecheck`, `test`, `test:integration`, `contracts:check`, `e2e`, and `i18n:fix`.
