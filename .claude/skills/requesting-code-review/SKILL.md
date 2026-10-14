---
name: requesting-code-review
description: Review a PR by number or URL, or review local branch and uncommitted changes. Use for requested reviews, substantial or high-risk changes, or required pre-merge review. Collect all findings and ask before publishing one GitHub review with inline comments.
---

# Requesting code review

Invoking this skill with a PR number or URL starts a review. PRs are the default use case. Review is read-only. Challenge the implementer's assumptions and choices against the project's quality standards. Do not propose fixes, suggestion blocks, or replacement code. Do not edit files or change git state.

## Resolve the scope

- Prefer `gh` CLI commands for GitHub inspection and publishing. Resolve a bare PR number against the current repository. Ask only if the repository or target is ambiguous.
- For a PR, use `gh pr view <number> --repo <owner/repo> --json number,url,title,body,baseRefName,baseRefOid,headRefName,headRefOid,files` and `gh pr diff <number> --repo <owner/repo>`. Inspect existing reviews and inline comments with `gh api`, using `--paginate` for list endpoints.
- Record the reviewed head SHA and inspect source at that revision. Do not assume the local checkout matches the PR. Read requirements, project instructions, surrounding code, callers, and relevant tests. If a diff is truncated, obtain the missing content before claiming full coverage.
- Register the PR with the thread when a PR-linking tool is available.
- Without an explicit target, try `gh pr view` for the current branch. If no PR exists, review local changes. Authentication or network failure does not establish that no PR exists. Report the blocker instead of silently switching scope.
- For uncommitted work, inspect `git status --short`, `git diff`, `git diff --cached`, and untracked file contents. For branch changes, identify the intended base and use its merge base, such as `git diff <base>...HEAD`. Do not assume `HEAD~1` covers the work. Include unfinished changes when reviewing the whole branch, and state the exact scope.
- Local-only reviews end with findings. Do not offer to publish comments or create a PR.

## Review and delegate

- Encourage review-capable subagents when the change is large, spans independent areas, has specialist risks, or benefits from an independent pass. Review directly when delegation would add little value.
- When delegating, assign focused passes and run independent passes in parallel. Select relevant roles rather than launching every role for every change:
  - Bugs and regressions. Check changed behavior, edge cases, compatibility, error handling, and meaningful test coverage.
  - Security. Check trust boundaries, authorization, injection, data exposure, and other concrete security risks. Load `security-review` when available.
  - Maintainability. Assign one reviewer, preferably the `simplicity` agent, the `unslop` checklist and `code-reviewer.md` requirements. Assess the approach before individual lines, using existing module boundaries and comparable implementations. Do not equate fewer lines with simpler code. Other reviewers should not repeat this pass.
- For a direct review, use the relevant checks in `code-reviewer.md` and load `unslop` for a read-only pass.
- Check changes against applicable codebase standards. Read `AGENTS.md`, contribution and style guides, relevant language or framework skills, lint and formatting configuration, and established nearby conventions. Give reviewers the relevant standards and require each to check compliance within their assigned scope. Flag concrete violations, including nonblocking ones. Cite the rule or established pattern when it is not obvious. Project-specific standards take precedence over generic preferences and `unslop` heuristics. Do not invent rules or flag unrelated pre-existing violations.
- Use [code-reviewer.md](code-reviewer.md) for each reviewer and supply its required context. Reviewers may report incidental issues outside their focus but should not duplicate another pass.
- Review changed code and problems introduced or exposed by the changes. Read full affected files and relevant callers before flagging an issue. Investigate uncertain candidates with code search or authoritative documentation. Describe realistic triggering conditions instead of hypothetical problems.
- Keep context focused on contracts and evidence, not the implementer's reasoning history. The coordinating agent owns validation, deduplication, the final findings list, and publication.

## Collect findings and ask

- Validate every candidate against inspected code and requirements. Remove false positives and merge duplicates, but retain every supported finding regardless of severity, including nonblocking style issues and nitpicks. Do not invent findings or treat personal preferences as defects.
- Present the complete list, ordered by severity. Give each finding a stable ID, severity or `nitpick` label, file and line, and a brief description of the problem and its consequence. No fix instructions, suggestion blocks, praise sections, or severity-based cutoff.
- Mention assumptions and verification gaps briefly. Claim checks passed only with evidence. If no issues were found, say so.
- For a PR with findings, ask: "Should I publish all these findings, including nitpicks, as inline comments in a single GitHub review?" Wait for explicit approval. The initial review request is not permission to publish. Honor any selection or edits the user requests.
- If there are no findings, do not publish an empty review unless requested.

## Publish one GitHub review

Publish all approved findings in the `comments` array of one submitted pull request review.

1. Recheck the PR head SHA before publishing. If it changed, revalidate the findings and line anchors against the new diff. Show material changes and ask for approval again before posting them.
2. Anchor each finding to the smallest relevant line or range in the reviewed diff. Use the exact repository-relative `path`, `line`, and `side`. `RIGHT` uses new-file line numbers; `LEFT` uses old-file line numbers for deletions. These are file line numbers, not diff offsets. For ranges, include `start_line` and `start_side`. Never invent an anchor or drop an unanchorable finding silently. Keep it in chat and agree on its disposition before publishing.
3. Keep each inline comment as brief as possible, usually one or two sentences describing only the mistake and consequence. Include a severity or `Nitpick` label. Do not repeat the file path, explain fixes, or add suggested code.
4. Create a JSON payload with the reviewed `commit_id`, `event: "COMMENT"`, a short `body`, and all approved inline comments. Use `APPROVE` or `REQUEST_CHANGES` only when the user explicitly requests that status. The body contains only a short note of what was reviewed and `Reviewed by <model name>`. Use the actual reviewing model name from runtime context. Do not substitute an agent role or guess the model. Ask if it is unavailable. Do not repeat findings in the body.

Example payload. Replace every placeholder and example location with verified values:

```json
{
  "commit_id": "<reviewed head SHA>",
  "event": "COMMENT",
  "body": "Reviewed the PR changes. Findings are inline.\n\nReviewed by <model name>",
  "comments": [
    {
      "path": "src/example.ts",
      "line": 42,
      "side": "RIGHT",
      "body": "Bug: Empty input reaches this branch and crashes the request."
    }
  ]
}
```

5. Submit the entire payload in one request using `gh api --method POST repos/<owner>/<repo>/pulls/<number>/reviews --input <payload.json>`. `gh pr review` alone cannot attach this inline-comments array. Do not use `gh pr comment` or POST each finding to `/pulls/<number>/comments`.
6. Verify the returned review state and inspect `/repos/<owner>/<repo>/pulls/<number>/reviews/<review-id>/comments` with `gh api --paginate` to confirm the expected comments belong to that review. Return its URL. If submission times out or has an uncertain result, inspect existing reviews before retrying to avoid duplicates. Report failures and unpublished findings accurately.
