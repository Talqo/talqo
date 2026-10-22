# End-To-End Tests

- Import `test` from `./application` or a fixture extending it. AI configuration is installation-wide, so workers must not share an API or database.
- Keep all browser projects fully parallel, with no ignored tests or preallocated worker servers.
- Never change seeded accounts. Create and clean up test-owned records, including knowledge files that the development seed does not provide.
- Cancel with Ctrl-C so Playwright shuts down the environment. Direct `SIGTERM` or `SIGKILL` termination can leave the container behind.
- Cancelling Docker during container creation can leave a stopped `Created` container. Remove the exact container named in the startup log with `docker rm <name>`.
