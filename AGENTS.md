# anki-alarm

Working name. Read `docs/spec.md` first: it holds the product decisions. Vocabulary is in
`GLOSSARY.md`.

## Issue tracker

GitHub Issues in `YgorPerez/anki-alarm`, through `gh`. Always use the YgorPerez account:

```bash
export GH_TOKEN=$(gh auth token --user YgorPerez)
```

`git push`/`fetch` in this repo are pinned to YgorPerez by a local credential helper.

### Wayfinding

- **Map:** the open issue labelled `wayfinder:map` ("Map: first release").
- **Tickets:** decision tickets are sub-issues of the map (`gh issue create --parent <map>`), labelled
  `wayfinder:<research|prototype|grilling|task>`.
- **Blocking:** GitHub's native dependencies:
  `gh api --method POST repos/YgorPerez/anki-alarm/issues/<child>/dependencies/blocked_by -F issue_id=<blocker database id>`
  (database id: `gh api repos/YgorPerez/anki-alarm/issues/<n> --jq .id`).
- **Frontier:**
  `gh api repos/YgorPerez/anki-alarm/issues/<map>/sub_issues --jq '.[] | select(.state=="open" and .issue_dependencies_summary.blocked_by==0 and (.assignees|length)==0) | "#\(.number) \(.title)"'`
- **Claim:** `gh issue edit <n> --add-assignee @me`, as the session's first write.
- **Resolve:** a code ticket closes through its PR. A ticket without code (`research`, `grilling`,
  `prototype`): comment the answer on it and close it. Either way, add one line (summary + link) to
  "Decisions so far" in the map's body.

## Flow

The `mattpocock-skills` and `impeccable` plugins are enabled in `.claude/settings.json`. If a
session can't load plugins, read the skill files straight from their GitHub repos.

The map (#1) holds decision tickets only: research, prototypes and grillings. When they're all
resolved, fold the answers into `docs/spec.md`, run `/to-tickets` to split the spec into
tracer-bullet build tickets with blocking links, and build each with `/implement`. Use Impeccable
for the visual direction and UI polish.

## Conventions

- Code, docs, issues, PRs and commits in English. UI copy is pt-BR first, with an English
  translation.
- Decision-heavy logic goes in `packages/core` (zero runtime dependencies besides `ts-fsrs`),
  test-first, tested through its public API.
