# opflow — Documentation

`opflow` connects Claude Code to **OpenProject** (task tracking) and **Nextcloud Talk** (daily reporting).
You ask Claude to build a feature; Claude breaks it into User Stories, creates them in OpenProject, closes
them as the work finishes, and posts an end-of-day report to your Talk room — **and every one of those writes
waits for your approval first.**

---

## 1. How it works

```
 You: "/plan-feature add CSV export"
        │
        ▼
 Claude drafts 3–10 User Stories ──► you: Approve / Edit / Cancel
        │ Approve
        ▼
 opflow op:create --yes ──► OpenProject: User Stories, assigned to you
        │
   ... Claude builds the feature ...
        │
 You: "/done-tasks"
        ▼
 Claude proposes finished stories ──► you: Approve / Edit / Cancel
        │ Approve
        ▼
 opflow op:done --yes ──► OpenProject: status = Closed
        │
 You: "/report-day"
        ▼
 Claude drafts the daily report ──► you: Approve / Edit / Cancel
        │ Approve
        ▼
 opflow talk:post --yes ──► Nextcloud Talk room
```

Two parts:

| Part | What it is | Where |
|---|---|---|
| **`opflow` CLI** | Zero-dependency Node.js script that talks to the OpenProject API v3 and the Nextcloud Talk (OCS) API. | `bin/opflow.js`, `src/` |
| **Claude Code skills** | `/plan-feature`, `/done-tasks`, `/report-day` — instructions that tell Claude how to draft, ask for approval, and call the CLI. | templates in `skills/`, installed to `~/.claude/skills/` |

The skills are installed **user-wide**, so they work in any project you open in Claude Code.

---

## 2. Requirements

- Node.js **18 or newer** (no `npm install` needed — there are no dependencies).
- An OpenProject account with access to the target project, and the **User Story** type enabled in it.
- A Nextcloud account with Talk, and a Talk room you're a member of.
- Claude Code.

---

## 3. Setup

### 3.1 Create `.env`

Copy the example and fill it in (the file is git-ignored — never commit it):

```bash
cp .env.example .env
```

| Key | What to put | Where to find it |
|---|---|---|
| `OP_URL` | Your OpenProject base URL, e.g. `https://openproject.example.com` | Browser address bar |
| `OP_API_KEY` | Personal API token | OpenProject → avatar → **My account** → **Access tokens** → API → generate |
| `OP_PROJECT` | Project identifier (or numeric id) | The project URL: `/projects/<identifier>` |
| `OP_BACKLOG` | Name of your team's backlog version, e.g. `Backlog: Android POS` (needed by `op:create`) | OpenProject → project → **Backlogs** |
| `NC_URL` | Your Nextcloud base URL, e.g. `https://cloud.example.com` | Browser address bar |
| `NC_USER` | Your Nextcloud username | Nextcloud profile |
| `NC_APP_PASSWORD` | An app password (not your login password) | Nextcloud → **Settings** → **Security** → **Devices & sessions** → create app password |
| `NC_TALK_ROOM` | Room token | Open the Talk room; the token is the part after `/call/` in the URL |

Environment variables with the same names override `.env` values (empty ones are ignored).
`.env` is always read from the repo folder, no matter which directory you run `opflow` from.

### 3.2 Enable the User Story type

OpenProject → your project → **Project settings** → **Work package types** → tick **User Story**.

### 3.3 Verify access (read-only)

```bash
node bin/opflow.js check
```

Expected:

```
OK    OpenProject user: <your name>
OK    OpenProject project: <project name>
OK    Type "User Story": id 7
OK    Status "Closed": id 12
OK    Current sprint: Sprint 152 (id 2165)
OK    Backlog version: Backlog: Android POS (id 2167)
OK    Talk room: <room name>
```

Any `FAIL` line tells you what's wrong — see [Troubleshooting](#8-troubleshooting).

### 3.4 Install the skills

```bash
npm run install-skills
```

This writes `/plan-feature`, `/done-tasks` and `/report-day` into `~/.claude/skills/`, with the absolute path to
this repo's `bin/opflow.js` filled in, and creates the git-ignored `.opflow/` working folder. It also creates your
personal `report-template.md` from `report-template.example.md` if you don't have one yet; it never overwrites it.

The first run also asks three questions about how `/plan-feature` breaks work into tickets:

| Question | Options (first is the default) |
|---|---|
| Unit tests / testing work | In acceptance criteria · Excluded · Separate ticket per feature |
| Ticket size | Balanced (2–4 pts, max 8) · Fewer, bigger (mostly 4 pts, max 5) · Detailed (1–2 pts, technical tasks allowed, max 10) |
| Docs and deployment work | In acceptance criteria · Excluded · Separate tickets |

Answers are saved in `.opflow/preferences.json` (git-ignored) and written into your installed `/plan-feature`.
Later runs reuse them. `npm run install-skills -- --reconfigure` asks again. With no terminal to ask in, the
defaults are used. Every option keeps the same basics: each ticket is one outcome a PM can check, no tickets for
code review or refactoring on their own, and a final merge/split pass before you see the table.

> Because the installed skills point at this folder's absolute path, **don't move or delete this folder**
> without re-running `npm run install-skills` from the new location.

### 3.5 Add the permission rules (manual)

Add both rules to `permissions.ask` in `~/.claude/settings.json`:

```json
{
  "permissions": {
    "ask": [
      "Bash(node *opflow.js*--yes*)",
      "PowerShell(node *opflow.js*--yes*)"
    ]
  }
}
```

With these, Claude Code asks you again before **any** `opflow` write command runs — whichever shell tool it uses.
The installer only prints these rules; it never edits your settings.

### 3.6 Session reminder (optional)

The skills only run when you type them (`disable-model-invocation: true`), so Claude never starts them on its own
during other work. To get a one-line reminder of them at the start of each new session, add this `SessionStart`
hook to `~/.claude/settings.json`. `npm run install-skills` prints it with your absolute path filled in:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup",
        "hooks": [{ "type": "command", "command": "node \"<this folder>/scripts/session-reminder.js\"" }]
      }
    ]
  }
}
```

The hook only gives Claude the reminder text. It runs nothing against OpenProject or Talk.

---

## 4. Daily use

Run these in Claude Code, in whatever project you're working on.

### `/plan-feature <description>`

```
/plan-feature add CSV export to the invoices page
```

1. Claude breaks the feature into User Stories in priority order, following your ticket-breakdown answers from
   install. Each story is a PM-checkable outcome, with a short imperative subject
   (≤ 80 chars), a description containing context plus an **Acceptance criteria** checklist, and **points**:
   `1` = 2h, `2` = 4h, `4` = 1 day (bigger stories are split).
2. Claude runs a dry run that places each story: the current sprint (the open `Sprint <N>` version with the highest
   N) holds up to **60 points** of your work, counting your open tasks already in it; stories that don't fit go to
   the `OP_BACKLOG` version.
3. You see them as a numbered table with **Points** and **Goes to**, plus the sprint total, and choose
   **Approve**, **Edit** or **Cancel**.
4. On **Approve**, Claude runs `op:create --yes`. Each story is created as a **User Story**, **assigned to you**,
   in its sprint or backlog version, with **Estimated time** = points × 2h, and you get back
   `#id subject -> version` for each one.

### `/done-tasks`

1. Claude lists your work packages updated today (or the ids you name).
2. It proposes which ones are finished, with a reason for each.
3. On **Approve**, they're set to **Closed**.

### `/report-day`

1. Claude pulls today's activity and fills in your report template (`report-template.md`). With the default
   template, the result looks like this:

   ```markdown
   **Daily report — 2026-09-22**

   **Done**
   - #101 Add CSV export button

   **In progress**
   - #102 Stream large exports — half done

   **Blockers**
   - None

   **Tomorrow**
   - Finish streaming, add tests
   ```

   **Done** = status Closed; **In progress** = everything else. If it doesn't know your blockers or plan for
   tomorrow, it asks you first.

   **Changing the format:** edit `report-template.md` in the opflow folder. It's plain Markdown that Talk renders.
   You can rename, reorder, add or remove sections and change the title. `{{date}}` becomes today's date, and
   `<!-- comments -->` are instructions for Claude, e.g. `<!-- one line per task, no ticket numbers -->`. They are
   followed but never posted. The file is git-ignored, so each dev keeps their own format. To start over, delete it
   and run `npm run install-skills`.
2. You see the exact text and choose **Approve**, **Edit** or **Cancel**.
3. On **Approve**, it's posted to your Talk room.

---

## 5. CLI reference

All commands: `node bin/opflow.js <command>`. Exit code is `0` on success, `1` on any error.
**Write commands are dry runs unless you add `--yes`.**

| Command | Writes? | What it does |
|---|---|---|
| `check` | no | Verifies OpenProject user, project, `User Story` type, `Closed` status, current sprint, `OP_BACKLOG` version and the Talk room. |
| `op:create --file <tasks.json> [--yes]` | with `--yes` | Creates User Stories assigned to you in the current sprint (up to 60 points) or the backlog. Dry run prints the split and the exact API payloads. |
| `op:done <id...> [--yes]` | with `--yes` | Sets work packages to **Closed**. Dry run shows each one's current status. |
| `op:today [--json]` | no | Lists your work packages updated today, grouped by status (or as JSON). |
| `talk:post --file <report.md> [--yes]` | with `--yes` | Posts the file's text to the Talk room. Dry run prints the message. |
| `help` | no | Prints usage. |

### `tasks.json` format

```json
[
  { "subject": "Add CSV export button", "description": "Context...\n\n**Acceptance criteria**\n- [ ] ...", "points": 2 },
  { "subject": "Stream large exports", "points": 4 }
]
```

- `subject` — required, non-empty, max 255 characters.
- `description` — optional Markdown string.
- `points` — required: `1` (2h), `2` (4h) or `4` (1 day). Order matters: earlier stories get sprint room first.

### Example output

```text
$ node bin/opflow.js op:create --file tasks.json
DRY RUN: 2 User Story(s) would be created and assigned to Ryan. Re-run with --yes to create.
Sprint 152: 54 existing + 2 new = 56/60 points
  Add CSV export button (2 pts)
Backlog: Android POS: 1 task(s)
  Stream large exports (4 pts)
[ { "subject": "Add CSV export button", ... } ]

$ node bin/opflow.js op:create --file tasks.json --yes
#101 Add CSV export button -> Sprint 152
#102 Stream large exports -> Backlog: Android POS
Removed tasks.json.

$ node bin/opflow.js op:done 101 --yes
#101 Add CSV export button -> Closed

$ node bin/opflow.js op:today
Closed:
  #101 Add CSV export button

In progress:
  #102 Stream large exports
```

### Behaviour worth knowing

- **Input files are deleted after a successful write.** After `op:create --yes` fully succeeds, or `talk:post --yes`
  succeeds, the `--file` input is removed so yesterday's tasks or report can never be re-sent by accident.
  Dry runs and failures keep the file.
- **Partial failures are reported, not hidden.** If `op:create` fails on story 3 of 5, it stops and prints which
  were created and which were not, so you can retry only the missing ones without duplicates.
- **`op:done` keeps going.** If one id fails, the rest are still processed; the exit code is `1`.
- **Edit conflicts are retried once.** If a work package changed between reading and closing it (HTTP 409),
  `op:done` re-reads it and tries once more.
- **"Today"** uses OpenProject's `today` filter; if your instance rejects it, `opflow` falls back to an explicit
  date range for your local date.
- **Talk message limit** is 32,000 characters; empty messages are rejected.

---

## 6. Approval safety — three layers

Nothing reaches OpenProject or Nextcloud without your explicit OK:

1. **The skills** always show the exact content and wait for **Approve** before running any `--yes` command.
   If writing the input file fails, they stop instead of running the command.
2. **The CLI** refuses to write without `--yes` — the default is always a dry run.
3. **Claude Code permissions** — the `ask` rules from [3.5](#35-add-the-permission-rules-manual) make Claude Code
   prompt you before any `opflow … --yes` command runs, even if a skill misbehaves.

Secrets are never printed: error messages show only the HTTP method, URL path and status, and `check` prints
names and ids only.

---

## 7. Files and folders

```
bin/opflow.js         CLI entry point (loads .env, wires the API clients)
src/cli.js            command parsing and the five commands
src/config.js         .env loading and validation
src/http.js           shared JSON HTTP helper + readable error messages
src/payloads.js       OpenProject request bodies, filters, tasks.json validation
src/openproject.js    OpenProject API v3 client
src/talk.js           Nextcloud Talk client
src/report.js         groups work packages by status
scripts/install.js    renders skills/ into ~/.claude/skills
scripts/session-reminder.js  optional SessionStart hook: one-line reminder of the skills
skills/               skill templates (plan-feature, done-tasks, report-day)
tests/                node:test unit tests (APIs are mocked — no network)
.env                  your credentials (git-ignored)
.opflow/              working files tasks.json / report.md (git-ignored)
report-template.md    your /report-day format (git-ignored; from report-template.example.md)
docs/superpowers/     design spec and implementation plan
```

### APIs used

| Action | Request |
|---|---|
| Who am I | `GET /api/v3/users/me` |
| Resolve type | `GET /api/v3/projects/{project}/types` → match "User Story" |
| Resolve status | `GET /api/v3/statuses` → match "Closed" |
| Sprint and backlog | `GET /api/v3/projects/{project}/versions` → open `Sprint <N>` with highest N, and `OP_BACKLOG` |
| Existing sprint load | `GET /api/v3/projects/{project}/work_packages?filters=…` (assignee = me, open, version = sprint) |
| Create story | `POST /api/v3/projects/{project}/work_packages` (with `estimatedTime` and `version`) |
| Close story | `GET` then `PATCH /api/v3/work_packages/{id}` with `lockVersion` |
| Today's work | `GET /api/v3/projects/{project}/work_packages?filters=…` (assignee = me, updated today) |
| Talk room info | `GET /ocs/v2.php/apps/spreed/api/v4/room/{token}` |
| Post message | `POST /ocs/v2.php/apps/spreed/api/v1/chat/{token}` |

OpenProject uses Basic auth with username `apikey` and your API token as the password. Talk uses Basic auth with
your username and app password, plus the `OCS-APIRequest: true` header.

---

## 8. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `Error: Missing config keys: …` | `.env` is missing or incomplete. It must be in the repo folder (next to `package.json`). |
| `FAIL OpenProject user: … 401` | Wrong or revoked `OP_API_KEY`, or wrong `OP_URL`. |
| `FAIL OpenProject project: … 404` | `OP_PROJECT` is wrong, or you're not a member of that project. |
| `Type "User Story" not found. Available: …` | Enable User Story in the project's settings (see 3.2), or check the spelling of the type name on your instance. |
| `Status "Closed" not found. Available: …` | Your instance names the done status differently; the list shows what exists. |
| `FAIL Current sprint: No open version named "Sprint <N>"…` | No sprint version is open in the project yet. |
| `FAIL Backlog version: …` | `OP_BACKLOG` is unset or doesn't match a version name; the error lists the available ones. |
| `FAIL Talk room: … 401` / raw XML in the error | Wrong `NC_USER` / `NC_APP_PASSWORD`. Use an app password, not your login password. |
| `FAIL Talk room: … 404` | Wrong `NC_TALK_ROOM` token, or you're not in that room. |
| `422 …` on create | You can't be assigned in that project, or a required custom field is missing. |
| `422 …` on close | The project's workflow doesn't allow moving to Closed from the current status for your role. |
| `/plan-feature` etc. not found in Claude Code | Run `npm run install-skills` and restart the Claude Code session. |
| Skills stopped working after moving the folder | Re-run `npm run install-skills` from the new location. |
| No approval prompt from Claude Code before writes | The `ask` rules from 3.5 aren't in `~/.claude/settings.json`. |

---

## 9. Development

```bash
npm test            # runs all unit tests (node --test), no network needed
```

- ES modules, Node's built-in `fetch`, `node:test` and `node:assert` — no dependencies.
- API clients take an injectable `fetch`; the CLI's `run(argv, deps)` takes injectable clients, file reader,
  file remover and logger, so every command is tested without touching real services.
- After changing a skill template in `skills/`, re-run `npm run install-skills`.

---

## 10. Known limitations

- `/done-tasks` only sees stories **updated today**; for older ones, name the ids (`/done-tasks 101 102`).
- `op:today` returns up to 100 work packages.
- If deleting the input file fails *after* a successful write (e.g. a Windows file lock), the command exits with a
  generic error and the file stays; delete it manually before re-running.
- One OpenProject project and one Talk room per install.
- `check` doesn't verify that you're assignable in the project or that the workflow allows Closed — those surface
  as `422` errors on first use.
