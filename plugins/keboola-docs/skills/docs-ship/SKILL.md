---
name: docs-ship
description: "Use only when the author says \"ok\", \"ок\", \"ship it\", \"открывай PR\", \"push and open the PR\" after a docs-page, docs-update or docs-retire commit in keboola/connection-docs. Pushes the branch, opens the pull request from references/pr-body.md (Diátaxis line per page, media, VERIFY owners, open questions, preview placeholder, stacked-on note), draft when something is unverified, and lets the plugin's hook label it. Never auto-triggered by another skill; never merges; never touches someone else's PR."
---

# docs-ship: push and open the PR, on "ok" only

## Overview

The three authoring skills end with a local commit and the sentence "say ok to ship". This skill
is that step. It exists so the PR is never a side effect: the author reads the handoff, says ok,
and only then does anything leave the machine.

## Preconditions

- The author's "ok" is in the conversation, after the commit it refers to. An ok given for the
  page map or the media list is not an ok to ship.
- `git status` is clean, the branch is not `main`, and the last commit passed the gate (no
  `DOCS_GATE=skip` on it; if there was one, say so and stop).
- The PR is the author's own (the plugin ships with `docs-pr-label/rules.json` naming the
  authors it labels for). Never push to, rebase or comment on another person's branch.

## Steps

1. `git push -u origin <branch>` (the fork remote the checkout uses; name it when it is not
   `origin`). On a stacked branch (base is another PR's branch), say so and pass `--base`.
2. Build the body from `references/pr-body.md`: fill every `<…>` from the state file
   (`${CLAUDE_PLUGIN_DATA}/docs-page/<repo-dir>--<branch>.md`) and `git diff --stat
   <base>...HEAD`. Sections with nothing to say are dropped, not left as placeholders.
3. `gh pr create --title "PRDCT-nnn: <title>" --body-file <scratch>/pr-body.md [--base
   <branch>] [--draft]`. `--draft` when any VERIFY on the diff has no answer yet, when a stop was
   skipped, or when the author said "draft".
4. The plugin's PostToolUse hook runs `docs-pr-label` and prints the labels it added. If it
   printed nothing, run `node "${CLAUDE_PLUGIN_ROOT}/skills/docs-pr-label/scripts/label-pr.mjs"
   --apply <url>` by hand.
5. Print the PR URL. Bind it to the session when the host has `ccd_pr` tools. Update the state
   file (`pr: <url>`). Do not request reviewers unless the author named them.

## Never

- Merge, enable auto-merge, or re-trigger review bots without a separate ok.
- Open a PR for a commit the author has not seen in a handoff block.
- Push over a rejected gate: a `DOCS_GATE=skip` commit ships only after the author repeats the ok
  knowing which check was skipped.
