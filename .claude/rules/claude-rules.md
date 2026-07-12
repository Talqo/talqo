---
paths:
  - ".claude/rules/*.md"
---

# Rules File Standards

## Philosophy

- Write reusable standards that change code, commands, review findings, or documentation.
- Favor current industry standards, strong defaults, and strict project consistency.
- State preferred tools, patterns, conventions, outputs, and exceptions.
- Assume the agent already knows technology syntax and concepts.
- Capture the philosophy behind the rule that the agent should follow.
- Include snippets only for required conventions or canonical project shapes.

## Scope

- Path scoping is routing, not project specificity.
- Use narrow globs that apply technology-specific rules only to relevant files.

## Style

- Use concise sections, direct language, and concrete technical terms.
- State the desired agent behavior.
- For common mistakes, state the replacement behavior.
- Merge related bullet points into one more specific rule.
