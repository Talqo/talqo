# End-To-End Tests

- AI configuration is installation-wide. Workers must not share an API or database.
- Never change seeded accounts. Create disposable accounts for tests that change passwords or roles.
- Resolve expected UI labels through `tests/i18n.ts` (`web`/`widget`); do not hardcode translated copy. The `language` fixture pins the dashboard to English.
