# End-To-End Tests

- AI configuration is installation-wide. Workers must not share an API or database.
- Never change seeded accounts. Create disposable accounts for tests that change passwords or roles.
- Resolve expected UI labels through `tests/i18n.ts` (`web`/`widget`); do not hardcode translated copy. The `language` fixture pins the dashboard to English.
- Root `bun run e2e` builds prerequisites. Direct runs from this app require current SDK, widget, and web builds; the custom UI fixture uses the built SDK.
