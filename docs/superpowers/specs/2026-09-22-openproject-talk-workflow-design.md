# OpenProject + Nextcloud Talk Daily Workflow — Design

Date: 2026-09-22
Status: Approved in chat, pending spec review

## Goal

Ask Claude Code to build a feature → Claude breaks it into tasks → after user approval, tasks are created in
OpenProject → as work finishes, Claude proposes closing tasks → after approval, tasks are closed → at end of day,
Claude drafts a report → after approval, it is posted to a Nextcloud Talk room.

Nothing is written to OpenProject or Nextcloud without explicit user approval.

## Decisions

- **Home:** Claude Code skills + a zero-dependency Node.js CLI (`dfly`), Node 18+ (built-in `fetch`).
- **Task structure:** flat work packages, all of type **User Story**, no parent.
- **Assignee:** every created work package is assigned to the API-key owner (`/api/v3/users/me`).
- **Done status:** `Closed`.
- **Report:** end-of-day summary, triggered manually via `/report-day`.

## Components

### CLI: `dfly` (single entry `bin/dfly.js`, modules under `src/`)

| Command | Behavior |
|---|---|
| `dfly check` | Read-only: `GET /api/v3/users/me`, resolves project/type/status, fetches Talk room info. Reports OK/FAIL per item. |
| `dfly op:create --file tasks.json [--yes]` | Without `--yes`: prints the exact payloads (dry run), exits 0. With `--yes`: creates each work package, prints `#id subject` per line. |
| `dfly op:done <id...> [--yes]` | Without `--yes`: prints current subject/status of each id. With `--yes`: sets status to `Closed`. |
| `dfly op:today [--json]` | Lists work packages assigned to me with `updatedAt` = today (local date), grouped by status. Read-only. |
| `dfly talk:post --file report.md [--yes]` | Without `--yes`: prints the message. With `--yes`: posts it to the configured room. |

Modules (each small, independently testable):
- `src/config.js` — loads and validates `.env` (fails listing every missing key).
- `src/openproject.js` — API client: `me()`, `resolveType(name)`, `resolveStatus(name)`,
  `createWorkPackage()`, `closeWorkPackage()`, `listUpdatedToday()`.
- `src/talk.js` — `roomInfo()`, `postMessage(text)`.
- `src/payloads.js` — pure builders: work package create body, close body, today-filter JSON.
- `src/report.js` — pure: groups `op:today` output by status for the skill to use.

### `tasks.json` format

```json
[
  { "subject": "Add login form", "description": "Markdown body incl. acceptance criteria" }
]
```

### Skills (templates in `skills/`, installed to `~/.claude/skills/`)

Skills are installed user-wide so they work in whatever project a feature is being built in. `scripts/install.js`
renders the templates, replacing `{{DFLY}}` with the absolute path to `bin/dfly.js` and `{{DATA_DIR}}` with the
absolute path to this repo's gitignored `.dfly/` directory (where `tasks.json` and `report.md` are written).

- **`/plan-feature <feature>`** — Breaks the feature into 3–10 User Stories (subject ≤ 80 chars; description
  with context + acceptance criteria). Shows them as a numbered table, then asks: Approve / Edit / Cancel.
  On approve: writes `tasks.json`, runs `dfly op:create --file tasks.json --yes`, shows created IDs.
- **`/done-tasks`** — Runs `dfly op:today`, proposes which open tasks look finished based on the session's work,
  asks for approval, then runs `dfly op:done <ids> --yes`.
- **`/report-day`** — Runs `dfly op:today --json`, drafts a report with sections *Done*, *In progress*,
  *Blockers*, *Tomorrow* (blockers/tomorrow asked of the user if unknown). Shows the final text, asks for
  approval, then runs `dfly talk:post --file report.md --yes`.

## API details

### OpenProject (API v3)

- Auth: HTTP Basic, username `apikey`, password = `OP_API_KEY`.
- Create: `POST {OP_URL}/api/v3/projects/{OP_PROJECT}/work_packages`
  ```json
  {
    "subject": "...",
    "description": { "format": "markdown", "raw": "..." },
    "_links": {
      "type":     { "href": "/api/v3/types/{userStoryId}" },
      "assignee": { "href": "/api/v3/users/{meId}" }
    }
  }
  ```
- Type lookup: `GET /api/v3/projects/{OP_PROJECT}/types`, match `name` case-insensitively to `User Story`.
- Status lookup: `GET /api/v3/statuses`, match `Closed`.
- Close: `GET /api/v3/work_packages/{id}` for `lockVersion`, then
  `PATCH /api/v3/work_packages/{id}` with `{ "lockVersion": n, "_links": { "status": { "href": "/api/v3/statuses/{closedId}" } } }`.
- Today: `GET /api/v3/work_packages?filters=[{"assignee":{"operator":"=","values":["me"]}},{"updatedAt":{"operator":"t","values":[]}}]&pageSize=100`
  (`t` = "today" operator; if the instance rejects it, fall back to `<>d` with today's date range).

### Nextcloud Talk (spreed)

- Auth: HTTP Basic with `NC_USER` + `NC_APP_PASSWORD` (app password from Nextcloud security settings).
- Headers: `OCS-APIRequest: true`, `Accept: application/json`.
- Room info: `GET {NC_URL}/ocs/v2.php/apps/spreed/api/v4/room/{NC_TALK_ROOM}`
- Post: `POST {NC_URL}/ocs/v2.php/apps/spreed/api/v1/chat/{NC_TALK_ROOM}` with JSON `{ "message": "..." }`.
- Message limit: 32,000 characters; CLI refuses longer messages.

## Configuration (`.env`, gitignored; `.env.example` committed)

`OP_URL`, `OP_API_KEY`, `OP_PROJECT` (identifier or numeric id), `NC_URL`, `NC_USER`, `NC_APP_PASSWORD`,
`NC_TALK_ROOM` (room token from the room URL `/call/<token>`).

## Approval model (defense in depth)

1. Skills always display the exact content and wait for explicit user approval before any write.
2. The CLI performs no write without `--yes`; default is a dry run.
3. Manual step: the user adds two permission `ask` rules, `Bash(node *dfly.js*--yes*)` and
   `PowerShell(node *dfly.js*--yes*)`, to user-level `~/.claude/settings.json` (the installer prints these; it does
   not edit settings) so Claude Code prompts again on every write, in every project, even if a skill misbehaves —
   whichever tool it uses to run the command.

## Error handling

- Non-2xx responses: print method, URL path, status, and OpenProject `errorIdentifier` + `message` or OCS
  `meta.message`; exit code 1.
- `409` on close (stale `lockVersion`): re-fetch once and retry; second failure is reported.
- `op:create` processes sequentially; on failure, prints the tasks already created and the failing one, then
  stops — so the user can re-run with only the remaining tasks and avoid duplicates.
- Missing type `User Story` or status `Closed`: fail with the list of available names.
- Secrets are never printed; `check` prints only URLs and user names.

## Testing

- `node --test` unit tests for `payloads.js`, `report.js`, `config.js`, and client functions with a mocked `fetch`
  (asserting URL, method, headers, body, lockVersion retry, error formatting).
- `dfly check` for live read-only verification against the real instances.

## Out of scope

Parent/child hierarchies, time tracking, scheduled/automatic reports, attachments, Talk bots/webhooks,
multi-project support.
