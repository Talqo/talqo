---
paths:
  - "**/*.tsx"
  - "**/*.jsx"
  - "**/*.ts"
---

# React Standards

## Architecture

- Use a layered UI structure: primitives, shared composed components, route screens/layouts, and shared non-React utilities.
- Keep reusable UI outside route files in component directories.
- Use `src/lib/` for shared non-React utilities.
- Use composition, context providers, or URL state for cross-component coordination.

## Data And State

- Use a dedicated server-state layer for fetching, caching, deduplication, invalidation, retries, and loading/error state.
- Put shareable UI state in URL search params: filters, search terms, pagination, sorting, selected tabs, and view modes.
- Keep local component state for ephemeral UI only: open menus, uncontrolled draft text, transient animation state.
- Use effects for synchronization with external systems.
- Include complete effect dependencies or restructure the code.
- Clean up subscriptions, timers, network requests, and observers.
- Use `AbortController` or equivalent cleanup for raw fetch effects.

## Forms And Validation

- Validate user input at the form boundary.
- Use schema-backed form validation for non-trivial forms.
- Keep validation schemas close to the form or shared with the API contract when the project has shared validation.
- Pair each input with accessible labels, descriptions, field-level errors, and submit state.

## Errors And Feedback

- Surface user-visible failures through the project's shared error notification pattern.
- Use a global toast, alert, or notification system for unexpected action and request failures.
- Use inline field errors for validation failures.
- Use empty states, loading states, retry actions, and partial-failure states for data views.

## Styling

- Use the project's design-system primitives and theme tokens.
- Define colors, radii, spacing, and semantic variants in the theme layer.
- Use semantic tokens for UI intent: background, foreground, muted, primary, destructive, and border.
- Keep component code free of one-off colors and ad hoc visual constants.

## Accessibility And UX

- Add ARIA for behavior native HTML cannot express.
- Keep keyboard navigation, focus management, labels, and visible focus states intact.
- Pair color with text, iconography, or structure for meaning.
- Preserve responsive task clarity across viewport sizes.

## Performance

- Use stable keys from data identity.
- Add memoization when there is a measured render cost or a stable API contract requires it.
- Split heavy routes, dialogs, editors, charts, and rarely used widgets.

## Verification

- Run the relevant typecheck, lint, component tests, or build after meaningful UI changes.
- Use behavior-focused tests for forms, data states, error states, and accessibility-critical interactions.
