#!/usr/bin/env bash
set -euo pipefail

if (( $# > 1 )); then
  printf 'Usage: %s [PR number or URL]\n' "$0" >&2
  exit 2
fi

metadata=$(gh pr view "$@" --json id,url --jq '[.id, .url] | @tsv')
IFS=$'\t' read -r pr_id pr_url <<< "$metadata"
host=${pr_url#https://}
host=${host%%/*}
pr_path=${pr_url#https://"$host"/}
repo=${pr_path%/pull/*}
number=${pr_path##*/}

printf 'PR: %s#%s\n\n' "$repo" "$number"
gh api graphql --hostname "$host" --paginate -F id="$pr_id" -f query='
  query($id: ID!, $endCursor: String) {
    node(id: $id) { ... on PullRequest {
      reviews(first: 100, after: $endCursor) {
        nodes { id state body isMinimized }
        pageInfo { hasNextPage endCursor }
      }
    } }
  }' --jq '.data.node.reviews.nodes[] |
    select(.isMinimized == false) | select(.body | test("\\S")) |
    "<review id=\"\(.id)\">\nstate: \(.state)\nsummary:\n\(.body | split("\n") | map("  " + .) | join("\n"))\n</review>\n"'

gh api graphql --hostname "$host" --paginate -F id="$pr_id" -f query='
  query($id: ID!, $endCursor: String) {
    node(id: $id) { ... on PullRequest {
      reviewThreads(first: 100, after: $endCursor) {
        nodes {
          id isResolved path subjectType line startLine originalLine originalStartLine isOutdated
          comments(last: 100) {
            nodes { fullDatabaseId body isMinimized pullRequestReview { id body isMinimized } }
          }
        }
        pageInfo { hasNextPage endCursor }
      }
    } }
  }' --jq '.data.node.reviewThreads.nodes[] | select(.isResolved == false) |
    .comments.nodes[0].pullRequestReview as $review |
    .comments.nodes |= map(select(.isMinimized == false)) |
    select(.comments.nodes | length > 0) |
    ("<thread id=\"\(.id)\"" +
      (if $review.isMinimized == false and ($review.body | test("\\S"))
       then " review=\"\($review.id)\"" else "" end) +
      ">\nfile: \(.path)"),
    (if .subjectType == "FILE" then "scope: file" else
      (if .line != null then (.startLine // .line)
       else (.originalStartLine // .originalLine // "unknown") end) as $start |
      "range: L\($start)-L\(.line // .originalLine // "unknown")"
     end),
    "outdated: \(.isOutdated)",
    (.comments.nodes[] |
        "<comment id=\"\(.fullDatabaseId)\">\n\(.body | split("\n") | map("  " + .) | join("\n"))\n</comment>"),
    "</thread>\n"'

gh api graphql --hostname "$host" --paginate -F id="$pr_id" -f query='
  query($id: ID!, $endCursor: String) {
    node(id: $id) { ... on PullRequest {
      comments(first: 100, after: $endCursor) {
        nodes { fullDatabaseId body isMinimized }
        pageInfo { hasNextPage endCursor }
      }
    } }
  }' --jq '.data.node.comments.nodes[] | select(.isMinimized == false) |
    "<comment id=\"\(.fullDatabaseId)\">\n\(.body | split("\n") | map("  " + .) | join("\n"))\n</comment>\n"'
