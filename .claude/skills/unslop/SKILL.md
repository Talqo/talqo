---
name: unslop
description: ALWAYS use this skill when writing or editing code. Cuts AI tells from code, comments, and documentation.
---

# Unslop

Remove AI patterns from code and its documentation.

## Process

- Scan for the patterns below.
- Rewrite. Preserve behavior, public contracts, and intended tone.

## Patterns to detect and fix

### Content

1. **Superficial -ing phrases.** "highlighting...", "ensuring...", "showcasing...". Delete or expand with real sources.
2. **Vague attributions.** "Experts believe", "Industry reports suggest", "Some critics argue". Name the source or delete.

### Language

3. **AI vocabulary.** Additionally, crucial, delve, enduring, enhance, fostering, garner, interplay, intricate, landscape (abstract), pivotal, showcase, tapestry (abstract), testament, underscore, vibrant. Replace with plain words.
4. **Fancy ways to say "is".** "serves as", "stands as", "boasts", "features". Just say "is" or "has".
5. **"Not just X, but Y."** State the point directly instead.
6. **Rule of three.** Forcing ideas into groups of three. Use the natural number.
7. **Synonym cycling.** Protagonist, main character, central figure, hero all in one paragraph. Pick one, repeat it.
8. **False ranges.** "from X to Y" where X and Y aren't on a meaningful scale. List topics directly.

### Style

9. **Em dash overuse.** Avoid em dashes entirely. Use periods or commas only (no parentheses, no en dashes, no hyphen-as-dash substitutes). If a thought needs separation, end the sentence or use a comma.
10. **Colon overuse.** Fine before a list or example; not as a mid-sentence connector. Rewrite so the point stands without comparison framing.
11. **Boldface overuse.** Don't bold every proper noun or acronym.
12. **Inline-header lists.** The tell is a bold label and colon that restates the line: "**Performance:** Performance improved...". Convert those to prose. A bold lead-in that ends in a period and adds new detail ("**Schema in TypeScript.** Tables live in one file.") is fine.
13. **Title case headings.** Use sentence case.
14. **Decorative emojis.** Remove from headings, bullets, code comments, log lines, and CLI output.
15. **Curly quotes.** Replace with straight quotes.

### Filler

16. **Filler phrases.** "In order to" becomes "To". "Due to the fact that" becomes "Because". "It is important to note that" gets deleted.
17. **Excessive hedging.** "could potentially possibly be argued that it might" becomes "may".
18. **Generic conclusions.** "The future looks bright." State specific plans or facts.

### Jargon

19. **Abstract metaphor nouns.** Substrate, wedge, vector, locus, vantage, nexus, primitive (as noun), harness (as metaphor), surface (as in "API surface"), bedrock, scaffolding (as metaphor), modality, paradigm, gold-plating, ratchet (as metaphor), evacuate (for moving code), endgame, north star, flywheel. These read as technical but usually have a plainer concrete word. "Gold-plating" becomes "more than the job needs". "Evacuate" becomes "move out". Pick the concrete word.

### Plain speech

20. **Say what it does, not how it feels.** "SQL you can read" names a feeling; "`.toSQL()` returns the exact string sent to the database" names the mechanism. Restate as a concrete instruction, fact, or number, or cut it. If the sentence could appear unchanged in another project's docs, it says nothing about this one.
21. **Shorten or split dense sentences.** If the reader has to backtrack to parse a sentence, break it in two or drop clauses. One idea per sentence.
22. **Active voice.** Prefer it. Catch "is/are/was/were + past participle" and name the actor: "queries are validated" becomes "the compiler validates queries". Passive is fine only when the actor is unknown or doesn't matter.
23. **Cut adverbs, or use a stronger verb.** "runs quickly" becomes "is fast" or the number. "significantly improves" becomes the measured delta. An adverb propping up a weak verb means the verb is wrong.
24. **Prefer the plain word.** "utilize" becomes "use", "leverage" becomes "use", "facilitate" becomes "help", "numerous" becomes "many", "in the event that" becomes "if". The fancier synonym is rarely clearer.
25. **Mannered prose.** Metaphor or flourish where a literal phrase exists: aphorisms ("wire it or delete it"), rhetorical fragments for effect, personified code ("the plan holds it"), figurative verbs ("rides along", "stands on"), stock framing phrases. "A dial worth turning" becomes "a parameter worth varying". Say what you mean. Rule 19 covers the metaphor nouns.
26. **Over-compression.** Dropped articles, verbless fragments, symbol-speak, and abbreviations that make the reader decode instead of read. "Parser rejects bad date → exit 2, no write" becomes "The parser rejects a bad date, exits with code 2, and writes nothing." Write whole sentences with their articles and verbs, and spell out arrows and abbreviations.

### Code

27. **Narrated comments.** The comment restates the next line: `// loop over users` above `for (const user of users)`. Delete it, or fix the names that made it seem necessary.
28. **Step and banner comments.** `// Step 1: ...`, `// ===== Validation =====`, boxed comment headers. Replace with structure: small functions with real names.
29. **Patch narration.** "Added X", "Fixed Y", "now handles Z", "this used to...". Comments record constraints, not edits; git history records edits. Delete.
30. **Boilerplate docstrings.** Docstrings that restate the signature: `@param name the name`, "This function validates the input." Document only non-obvious contracts, invariants, and units; delete the rest.
31. **Commented-out code.** Delete it. Git keeps history.
32. **Redundant checks.** Null or type checks the type system, schema, or caller contract already guarantees; `if (arr)` before a loop; `typeof x !== "undefined"`. Validate at boundaries; trust contracts inside them.
33. **Catch-and-swallow.** A `catch` that logs and returns null or an empty value, converting failure into wrong data. Let it propagate, or handle it deliberately and observably.
34. **Silent fallbacks.** `?? default`, `|| {}`, long `?.` chains that mask broken invariants. Add a fallback only for a real requirement, and make it observable.
35. **Speculative generality.** Interface, factory, registry, config option, or "just in case" parameter serving one caller. Implement the current need; abstract at the second use.
36. **Pass-through wrappers.** Functions that only forward calls, adding no contract of their own. Call the target directly.
37. **Duplicated utilities.** Re-implementing what the codebase, its dependencies, or the standard library already provides. Search before writing; reuse or extend the established implementation.
38. **Unrequested scope.** Extra flags, options, env vars, features, and reformatting beyond the task. Build what was asked; report other opportunities separately.
39. **Type escapes.** `any`, unchecked casts, `@ts-ignore`, `# type: ignore`, non-null assertions that silence the compiler instead of fixing the type. Fix the type; a rare escape needs a comment stating why.
40. **Orphan TODOs.** TODO/FIXME/HACK without an owner, condition, or issue reference. Do it, file it, or delete it.
41. **Debug leftovers.** `console.log`, `print`, `debugger`, unused imports, dead branches from development. Remove them before finishing.
42. **Hollow tests.** Tests that re-assert the mock setup, tautological assertions, unreviewed snapshots, mocks of the unit under test itself. A test that cannot fail tests nothing; assert behavior the caller depends on.
