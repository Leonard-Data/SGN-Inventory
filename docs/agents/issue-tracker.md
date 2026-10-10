# Issue tracker: GitHub

Issues and specs live in GitHub Issues for `Leonard-Data/SGN-Inventory`.
Use the `gh` CLI from this clone; verify the target with `git remote -v`.

## Conventions

- Create: `gh issue create --title "..." --body "..."`
- For multiline bodies, use `--body-file <file>` with a temporary UTF-8 file.
- Read: `gh issue view <number> --comments`; include labels when inspecting state.
- List: `gh issue list --state open --json number,title,body,labels,comments`
  with appropriate `--label` and `--state` filters.
- Comment: `gh issue comment <number> --body "..."`
- Add/remove labels: `gh issue edit <number> --add-label "..."`
  or `--remove-label "..."`. Use `docs/agents/triage-labels.md`.
- Close: `gh issue close <number> --comment "..."`

When a skill says "publish to the issue tracker", create a GitHub issue.
When it says "fetch the relevant ticket", read the issue and its comments.

Repository authorization rules in `AGENTS.md` still apply. Configuring this
tracker does not authorize remote writes. If access is denied, report the
blocker rather than silently switching trackers.

## Pull requests as a triage surface

**PRs as a request surface: no.**

GitHub shares issue and PR numbers. For an ambiguous reference, resolve with
`gh pr view <number>` and fall back to `gh issue view <number>`.

## Wayfinding operations

- Map: one issue labelled `wayfinder:map`, containing Notes,
  Decisions-so-far and Fog.
- Child ticket: link it as a GitHub sub-issue using `gh api`. If sub-issues
  are unavailable, use a task list in the map and `Part of #<map>` in the child.
  Label tickets `wayfinder:research`, `wayfinder:prototype`,
  `wayfinder:grilling` or `wayfinder:task`.
- Blocking: use native issue dependencies:
  `gh api --method POST repos/Leonard-Data/SGN-Inventory/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`.
  Obtain the database ID with
  `gh api repos/Leonard-Data/SGN-Inventory/issues/<blocker> --jq .id`;
  it is not the issue number or node ID. If dependencies are unavailable,
  record `Blocked by: #<number>` in the child.
- Frontier: select the first open child in map order with no open blockers
  and no assignee. Native `issue_dependencies_summary.blocked_by` counts
  open blockers; otherwise resolve each recorded blocker's state.
- Claim: `gh issue edit <number> --add-assignee @me`.
- Resolve: comment with the result, close the child, then append a gist and
  ticket link to the map's Decisions-so-far.
