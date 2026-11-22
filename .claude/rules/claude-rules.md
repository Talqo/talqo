---
paths:
  - ".claude/rules/**/*.md"
---

# Writing Claude rules

- Keep a rule only if it changes a decision the model would otherwise get wrong. Write down local contracts, exceptions, and recurring mistakes.
- Leave mechanical checks to tools and workflows to skills. Use existing code to show conventions. Keep each instruction in one place.
- Scope each rule to the files it applies to. Use global rules for defaults that apply across tasks.
