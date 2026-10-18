# Upload screenshots and videos to GitHub

Keep screenshots and recordings outside the checkout. Upload with `--attach /tmp/demo.webm` and put the matching reference alone in a paragraph of the PR body:

```markdown
![](/tmp/demo.webm)
```

GitHub replaces the reference with a playable asset URL; bare paths are not rewritten. For before/after screenshots, use labeled image references and repeat `--attach` per file.

Fetch the live body before replacing it to preserve uploaded URLs and other changes. Verify the published body and playback. On failure, inspect GitHub before retrying; the PR or attachments may already exist.
