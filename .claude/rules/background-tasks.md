# Background Task Context Budget

Long-running background jobs are killed by the model's input limit (the LLM proxy rejects requests over ~623k tokens) when large tool results accumulate. These rules keep context small.

## Sub-agent Output

- Never read a background `local_agent` task's `.output` file: it is a symlink to the full sub-agent transcript (thinking, tool calls — hundreds of KB), not its report.
- Do not poll `TaskOutput` (especially `block: true`) on `local_agent` tasks: each poll inlines the entire transcript snapshot. Repeated polls on one task duplicate hundreds of KB into context.
- Wait for the task-notification and use the agent's final report — that is the result.
- If a status check is unavoidable, use a single non-blocking check, then stop polling.
- Keep sub-agent prompts scoped (specific question, bounded file set) so their transcripts stay small if they ever must be inspected.

## Large Tool Output

- Never read large files whole (lockfiles, built bundles, logs); use `offset`/`limit`, `head`/`tail`, or `grep`/`sed` ranges.
- Cap command output that can grow unbounded (`gh api`, test runs, dev-server logs) with `| head`, `| jq` filtering, or redirect to a file and read slices.
- Prefer summarizing data (`wc`, `jq length`, column of counts) over dumping raw payloads into context.
