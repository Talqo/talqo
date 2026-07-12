---
paths:
  - ".claude/agents/*.md"
---

# Agent Definition Standards

## Philosophy

- Define agents as distinct roles that provide a specific view on the work.
- Use agents to specialize judgment beyond the default general agent.
- Optimize each agent for one durable perspective: review, research, architecture, testing, security, operations, or UX.
- Use the body to define purpose, philosophy, judgment, priorities, and tradeoffs.
- Prefer capability-based agents over stack-specific developer agents when rules already cover the stack.
- Keep prompts compact so the agent spends most context on the user's task.

## Frontmatter

- Make `description` answer when the agent should be used, not what the agent is called.
- Include proactive trigger language for work that benefits from this agent's perspective.
- Scope tools to the agent's role so the tool list reinforces the intended behavior.
- Use read-only tools for agents whose value is independent judgment.
- Grant edit tools only when the agent owns implementation or test authoring.
- Override the model only for a deliberate cost, latency, or reasoning tradeoff.

## Body

- Start with the agent's purpose and philosophy before workflow details.
- Define what the agent optimizes for and how it evaluates tradeoffs.
- Give focused workflow steps only when they improve consistency.
- Specify only the handoff fields needed for the role, such as findings, evidence, verification, recommendation, or verdict.
- Use positive prescriptive language and concrete technical terms.
- Include examples only when they define a required output shape.
