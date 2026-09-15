# End-To-End Tests

- Test critical journeys through the real web app and API.
- Use the API-owned shared development seed as the isolated-database baseline; create and clean up journey-specific records in the owning spec.
- Mock only external providers; never use fixed sleeps.
- Add auth setup or page objects only after repeated use.
