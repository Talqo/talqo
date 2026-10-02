# Architecture Decision Records

Write an ADR when at least two credible options existed, each with a cost or risk worth accepting, and a future contributor would otherwise reopen the choice. Skip one when there was no real alternative, when the choice is cheap to reverse, or when `docs/architecture.md` already settles it. Record the rationale for those smaller choices beside the code instead.

## Rules

- Store ADRs in this directory as `NNNN-present-tense-imperative.md`, starting with `0001` and never reusing a number.
- Record exactly one decision per ADR.
- Use only the sections and order in the template below.
- Keep the body under 150 words. Each section must be one short paragraph.
- In `Context`, include only the problem, decisive constraints, and credible alternatives.
- In `Decision`, state the choice in one sentence.
- In `Consequences`, state only material benefits, costs, and follow-up work.
- Use one dated status: `Proposed`, `Accepted`, `Deprecated`, or `Superseded by ADR-NNNN`.
- After acceptance, do not rewrite history. Replace a decision with a new ADR and mark the old ADR as superseded.
- Keep ADRs concise and commit them with the code that enacts the decision when practical.

## Template

```markdown
# NNNN: Use a present-tense imperative title

## Status

Proposed (YYYY-MM-DD)

## Context

What forces are at play, and what alternatives and trade-offs matter?

## Decision

What will we do?

## Consequences

What becomes easier or harder as a result?
```

Based on [ADR project](https://github.com/architecture-decision-record/architecture-decision-record).
