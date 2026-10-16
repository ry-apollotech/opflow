# opflow session journal, ticket reconciliation and cross-project reports — design

**Date:** 2026-10-16
**Status:** draft, awaiting review

## Goal

Keep a reliable, per-project record of the features built and bugs fixed in Claude Code sessions, without the dev
writing it by hand. Use that record to keep OpenProject tickets in step with real work and to draft one daily report
that covers every project worked on that day.

Built as three sub-projects, in order. Each is usable on its own once done:

1. **Session journal** — capture, storage, context at session start.
2. **Ticket reconciliation** — `/opflow:done-tasks` works from the journal.
3. **Cross-project daily report** — `/opflow:report-day` works from the journal.

## Decisions (from discussion)

- **Ships in opflow for the whole team.** No dependency on other plugins (e.g. everything-claude-code's session files).
- **Capture:** hooks record facts automatically; Claude records feature/bug notes itself via a local-only CLI
  command, without asking each time. This is the one exception to "never run opflow unless the user types it".
- **What is recorded:** features built and bugs fixed only. No tests, files changed, decisions, blockers, or
  requested-but-not-built items.
- **Storage:** append-only JSONL per project per day under `~/.opflow/journal/`. Not inside repos, not in
  `CLAUDE.md`/`AGENTS.md`.
- **Repo → OpenProject project mapping:** optional per repo. Unmapped repos are journaled and reported, never ticketed.
- **Evidence:** "done" requires a commit. A done note without a commit is reported as in progress, "(not committed)".
- **Unchanged:** every OpenProject/Talk write is dry-run by default and needs the user's explicit Approve; the three
  skills stay user-typed (`disable-model-invocation: true`); points, sprint capacity, backlog overflow.

## Non-goals

- Recording tests, test results, changed files, decisions, blockers or next steps.
- Capturing work done outside Claude Code automatically (Claude can still note it, with `--commit` if one exists).
- Running reconciliation or reporting automatically at end of day.
- Editing or deleting journal entries in place.

---

## 1. Session journal

### Project identity

- Root = `git rev-parse --show-toplevel`; for a worktree, the main repo's root (from `git rev-parse --git-common-dir`).
  No git → the cwd.
- `~/.opflow/projects.json`: `{ "<root path>": { "slug": "tdm", "opProject": "tdm" | null | false } }`.
  - `slug` = root folder name, lower-cased; `-2`, `-3`… if another root already has it. Assigned on first sight.
  - `opProject`: identifier string = mapped; `null` = not decided yet; `false` = never ticket.
- Writes to `projects.json` go through write-temp-then-rename so a crash can't truncate it.

### Event file

`~/.opflow/journal/<slug>/<YYYY-MM-DD>.jsonl` (local date). One JSON object per line, written with a single
`appendFile` call so concurrent sessions don't interleave. Common fields: `ts` (ISO), `session` (Claude session id),
`source` (`"hook"` | `"claude"`), `kind`.

| kind | source | extra fields |
|---|---|---|
| `session_start` | hook | `cwd`, `branch`, `head`, `trigger` (startup/resume/clear/compact) |
| `session_end` | hook | `head`, `reason` |
| `commit` | hook | `hash`, `subject` |
| `feature` / `bug` | claude | `status` (`done`/`partial`), `text`, `ticket?`, `commit?` |
| `ticket_link` | cli (sub-project 2) | `note` (ts+session of the note), `ticket`, `action`, `opProject` |

Readers skip and count unparseable lines; they never fail on them.

### Hooks (`hooks/hooks.json`)

- **SessionStart** (all triggers): append `session_start`; output the context block (below); on `startup` only, also the existing reminder.
- **PostToolUse**, matcher `Bash`: if the command contains `git commit`, read `git log -1 --format=%H%x09%s` in the
  cwd and append `commit` unless that hash is already in today's file. Any other command → exit immediately.
- **SessionEnd**: append `session_end`.
- Hooks never block or fail the session: every error is swallowed after writing one line to
  `~/.opflow/journal/errors.log`.

### `opflow journal:note`

```
opflow journal:note --kind feature|bug --status done|partial --text "…" [--ticket 123] [--commit <hash>]
```

- Project from the cwd; session id from `CLAUDE_SESSION_ID` if set, else the newest `session_start` for this
  project today.
- `--commit` is checked with `git cat-file -e`; unknown hash → error. Without `--commit`, links the latest `commit`
  event of this session, if any.
- `--text` required, max 200 chars. `--ticket` digits only.
- Local write only; no `--yes` needed. Setup offers an allow rule:
  `Bash(node *opflow.js* journal:note*)`, `PowerShell(node *opflow.js* journal:note*)`.

### Session-start context

At most ~20 lines, only if the project has any journal history:

- this project's feature/bug items from today (collapsed, see below);
- `partial` items from the project's most recent earlier day;
- a note if a previous session today has no `session_end` (ended unexpectedly).

Plus an instruction: when a feature is finished or partly built, or a bug is fixed, run `journal:note` once for it;
note the ticket id if known.

### Collapsing

When rendering, notes are grouped per item: same `--ticket`, or same kind and same text after lower-casing and
trimming. The latest note in a group wins (so `partial` → `done` shows once as done).

### `opflow journal:show`

`journal:show [--project <slug>] [--date YYYY-MM-DD] [--json]` — default all projects, today. Markdown: per
project, **Features** / **Bugs fixed**, each line `text [done|partial] (commit abc1234 | not committed) #ticket`.

### Retention

Kept indefinitely; files are small.

---

## 2. Ticket reconciliation (`/opflow:done-tasks`)

### `opflow reconcile:candidates [--date D]` (read-only, JSON)

For each mapped project with journal items that day, with no `ticket_link` yet:

- the collapsed notes (with commit or not);
- candidate tickets: the note's `--ticket`, the user's open work packages in the project's current sprint and
  backlog, and a subject text search per note (OpenProject `search` filter — verify on the team's version; if
  unsupported, fall back to open tickets only).

Projects with `opProject: null` are listed under `unmapped`.

### Skill flow

1. Run `reconcile:candidates`. For each `unmapped` repo, ask once: map to the configured project / another
   identifier / never ticket. Save via `opflow project:map <slug> <identifier|--never>`.
2. Claude proposes one action per note:

| Situation | Action |
|---|---|
| done + commit + matching ticket whose acceptance criteria are met | **Close** |
| partial, or done but criteria not all met | **Comment** with progress; status unchanged |
| done + commit + no matching ticket | **Create** (User Story for feature; `Bug` type if the project has it, else User Story), current sprint, then Close |
| partial + no matching ticket | **Create** open (normal sprint/backlog placement) |
| no commit, ambiguous or multiple matches | **No action**, with the reason |

3. One table: `Project | Note | Ticket | Action | Evidence`. AskUserQuestion: Approve / Edit / Cancel.
4. On Approve, apply with `--yes`: `op:create` (gains `--project`, `--type`, `--closed`), `op:done` (gains
   `--project`), new `op:comment <id> --file <md> [--project]` (`POST /api/v3/work_packages/{id}/activities`).
   Each successful action appends a `ticket_link` event. Failures are shown verbatim; already-applied actions keep
   their links so a re-run skips them.

### Multi-project

One OpenProject client per mapped identifier, same credentials. Sprint/backlog resolved per project. The backlog
version name from setup applies only to the configured project; other projects without a backlog get the
"not created (sprint is full)" behaviour for open tickets. Tickets created Closed don't count toward the 60 points.

---

## 3. Cross-project daily report (`/opflow:report-day`)

### `opflow report:data [--date D] --json` (read-only)

Per project (mapped and unmapped): collapsed journal items merged with `op:today` results from that project's
OpenProject (mapped only). A journal item with a `ticket_link` and its ticket appear once.

| Item | Section |
|---|---|
| done note with commit, or ticket Closed that day | `done` |
| partial note, or ticket updated that day but not Closed | `inProgress` |
| done note without commit | `inProgress`, flagged `notCommitted` |

### Skill changes

- Uses `report:data` instead of `op:today`.
- Template unchanged in mechanism. New default template groups Done / In progress per project, then Blockers and
  Tomorrow (still asked from the user). Setup writes it only when no template exists.
- After posting, save the posted text to `~/.opflow/reports/<date>.md`. If that file already exists, the skill asks
  whether to post an update before drafting.

---

## Testing

`node --test`, no dependencies, same style as existing tests (fakes for fetch and fs, temp `OPFLOW_HOME`).

- Project identity: git root, worktree → main root, no git, slug collisions, `projects.json` atomic write.
- Journal: append + read, concurrent appends from two processes, bad lines skipped, collapsing rules.
- Hooks: each hook's event, commit dedupe, non-commit Bash exits fast, errors never propagate (exit 0).
- `journal:note`: validation, commit check, auto-link.
- Session context: today + previous day partials, unclosed session, line cap.
- `reconcile:candidates`: skips linked notes, unmapped list, search fallback.
- `op:comment`, `op:create --closed/--type/--project`, `ticket_link` written only on success.
- `report:data`: evidence rules, merge with tickets, unmapped projects.

## To verify during implementation

- OpenProject `search` filter on the team's version.
- `CLAUDE_SESSION_ID` availability in Bash commands; fallback as above.
- PostToolUse hook timing on Windows/PowerShell (node start per Bash call).
