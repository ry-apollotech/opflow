# opflow — Documentation

`opflow` connects Claude Code to **OpenProject** (task tracking) and **Nextcloud Talk** (daily reporting).
You ask Claude to build a feature; Claude breaks it into User Stories, creates them in OpenProject, closes
them as the work finishes, and posts an end-of-day report to your Talk room — **and every one of those writes
waits for your approval first.**

---

## 1. How it works

```
 You: "/opflow:plan-feature add CSV export"
        │
        ▼
 Claude drafts 3–10 User Stories ──► you: Approve / Edit / Cancel
        │ Approve
        ▼
 opflow op:create --yes ──► OpenProject: User Stories, assigned to you
        │
   ... Claude builds the feature ...
        │
 You: "/opflow:done-tasks"
        ▼
 Claude proposes finished stories ──► you: Approve / Edit / Cancel
        │ Approve
        ▼
 opflow op:done --yes ──► OpenProject: status = Closed
        │
 You: "/opflow:report-day"
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
| **Claude Code plugin** | `/opflow:setup`, `/opflow:plan-feature`, `/opflow:done-tasks`, `/opflow:report-day` — skills that tell Claude how to draft, ask for approval, and call the CLI — plus a session reminder hook. | `.claude-plugin/`, `skills/`, `hooks/` |

The plugin is installed **user-wide**, so the commands work in any project you open in Claude Code. They only run when you type them.

---

## 2. Requirements

- Node.js **18 or newer** (no `npm install` needed — there are no dependencies).
- An OpenProject account with access to the target project, and the **User Story** type enabled in it.
- A Nextcloud account with Talk, and a Talk room you're a member of.
- Claude Code.

---

## 3. Setup

### 3.1 Install the plugin

In Claude Code:

```
/plugin marketplace add ry-apollotech/opflow
/plugin install opflow@opflow
```

The repo is private, so your git must already be able to clone it (e.g. `gh auth login`). Updates arrive with
`/plugin update opflow`, or automatically if auto-update is on for the marketplace.

### 3.2 Run setup

Type `/opflow:setup`. Claude explains what's needed and shows the command to run **in your own terminal**:

```bash
node "<plugin folder>/bin/opflow.js" setup
```

It needs a real terminal so it can hide what you type for secrets. It asks, in order:

| Value | Where to find it |
|---|---|
| OpenProject URL | Your OpenProject base URL, e.g. `https://openproject.example.com` |
| OpenProject API token (hidden) | OpenProject → avatar → **My account** → **Access tokens** → API → generate |
| Project identifier (or numeric id) | The project URL: `/projects/<identifier>` |
| Backlog version name (optional) | OpenProject → project → **Backlogs**, e.g. `Backlog: Android POS` (where overflow stories go). Enter skips it; with no backlog, overflow stories are not created. Type `-` to remove a saved one. |
| Nextcloud URL | Your Nextcloud base URL, e.g. `https://cloud.example.com` |
| Nextcloud username | Nextcloud profile (login name) |
| Nextcloud app password (hidden) | Nextcloud → **Settings** → **Security** → **Devices & sessions** → create app password |
| Talk room token | Open the Talk room; the token is the part after `/call/` in the URL |

After the values, setup does four more things:
1. It asks three questions about how `/opflow:plan-feature` breaks work into tickets:

   | Question | Options (first is the default) |
   |---|---|
   | Unit tests / testing work | In acceptance criteria · Excluded · Separate ticket per feature |
   | Ticket size | Balanced (2–4 pts, max 8) · Fewer, bigger (mostly 4 pts, max 5) · Detailed (1–2 pts, technical tasks allowed, max 10) |
   | Docs and deployment work | In acceptance criteria · Excluded · Separate tickets |

   Every option keeps the same basics: each ticket is one outcome a PM can check, there are no tickets for code
   review or refactoring on their own, and a final merge/split pass runs before you see the table.
2. It creates your report template, if you don't have one yet.
3. It runs `check`.
4. It offers to add the approval rules from 3.5 to your Claude Code settings.

**Re-running setup:**
- Run it any time. Pressing Enter keeps each current value; secrets are shown masked as `****1234`.
- `--keep-preferences` skips the three questions.
- If you used an earlier version with a `.env` in the repo folder, setup offers it as the starting values.

Everything is saved in your own folder, `~/.opflow/`. Plugin updates never touch it:

| File | What it is |
|---|---|
| `.env` | your credentials (mode 600) |
| `preferences.json` | your ticket-breakdown answers |
| `report-template.md` | your `/opflow:report-day` format |
| `tasks.json`, `report.md` | working files, deleted after a successful write |

Set `OPFLOW_HOME` to use a different folder. Environment variables named like the `.env` keys (`OP_URL`,
`OP_API_KEY`, …) override the file; empty ones are ignored.

### 3.3 Enable the User Story type

OpenProject → your project → **Project settings** → **Work package types** → tick **User Story**.

### 3.4 Verify access (read-only)

Setup runs this for you at the end. To run it again, use `/opflow:setup` step 3, or:

```bash
node "<plugin folder>/bin/opflow.js" check
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

### 3.5 Approval rules

Setup offers to add both rules to `permissions.ask` in `~/.claude/settings.json`:
- It keeps everything else in the file and saves a copy of the old file as `settings.json.opflow-backup`.
- It never adds a rule twice.
- It leaves a file it can't parse unchanged.

If you decline, add them yourself:

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

With these, Claude Code asks you again before **any** `opflow` write command runs, whichever shell tool it uses.

### 3.6 Session reminder and journal hook

The plugin includes one hook script, `scripts/journal-hook.js`, so there's nothing to set up. It runs when a session
starts, after Bash/PowerShell commands, and when a session ends:

- At the start of each new session, Claude mentions the opflow commands once, in one line (only `/opflow:setup`
  until you've run setup), and gets the project's journal context (see the README's **Session journal**).
- After a command that commits, it records the new commit in the journal.
- It never runs anything against OpenProject or Talk, and never fails a session: errors are written to
  `~/.opflow/journal/errors.log`.

---

## 4. Daily use

Run these in Claude Code, in whatever project you're working on.

### `/opflow:plan-feature <description>`

```
/opflow:plan-feature add CSV export to the invoices page
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

### `/opflow:done-tasks`

1. Claude lists your work packages updated today (or the ids you name).
2. It proposes which ones are finished, with a reason for each.
3. On **Approve**, they're set to **Closed**.

### `/opflow:report-day`

1. Claude pulls today's activity and fills in your report template (`~/.opflow/report-template.md`). With the default
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

   **Changing the format:** edit `~/.opflow/report-template.md`. It's plain Markdown that Talk renders.
   You can rename, reorder, add or remove sections and change the title. `{{date}}` becomes today's date, and
   `<!-- comments -->` are instructions for Claude, e.g. `<!-- one line per task, no ticket numbers -->`. They are
   followed but never posted. The file is git-ignored, so each dev keeps their own format. To start over, delete it
   and re-run `/opflow:setup`.
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
3. **Claude Code permissions** — the `ask` rules from [3.5](#35-approval-rules) make Claude Code
   prompt you before any `opflow … --yes` command runs, even if a skill misbehaves.

Secrets are never printed: error messages show only the HTTP method, URL path and status, and `check` prints
names and ids only.

---

## 7. Files and folders

```
.claude-plugin/       plugin.json + marketplace.json (the repo is its own marketplace)
hooks/hooks.json      SessionStart / PostToolUse / SessionEnd → scripts/journal-hook.js
bin/opflow.js         CLI entry point (loads ~/.opflow/.env, wires the API clients; setup, plan:rules)
src/cli.js            command parsing and the OpenProject and Talk commands
src/config.js         .env loading and validation
src/http.js           shared JSON HTTP helper + readable error messages
src/payloads.js       OpenProject request bodies, filters, tasks.json validation
src/openproject.js    OpenProject API v3 client
src/talk.js           Nextcloud Talk client
src/report.js         groups work packages by status
src/home.js           ~/.opflow location and config loading
src/setup.js          interactive setup
src/preferences.js    ticket-breakdown questions and rules
src/main-module.js    "is this file being run directly" check
src/project.js        repo root detection and ~/.opflow/projects.json
src/journal.js        journal files: append, read, collapse notes
src/journal-view.js   journal:show Markdown and the session-start context
src/journal-cli.js    journal:note and journal:show
scripts/journal-hook.js      the journal hook (session start/end, commits, context)
scripts/session-reminder.js  the reminder text the hook adds on startup
skills/               plugin skills (setup, plan-feature, done-tasks, report-day)
report-template.example.md  default /opflow:report-day format
tests/                node:test unit tests (APIs are mocked — no network)
~/.opflow/            your credentials, preferences, report template and working files (outside the repo)
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
| `Error: opflow is not set up. …` | Run `/opflow:setup`. |
| `setup needs a terminal` | Run the printed command in your own terminal, not with `!` inside Claude Code. |
| `Error: Missing config keys: …` | `~/.opflow/.env` is incomplete. Re-run setup. |
| `FAIL OpenProject user: … 401` | Wrong or revoked `OP_API_KEY`, or wrong `OP_URL`. |
| `FAIL OpenProject project: … 404` | `OP_PROJECT` is wrong, or you're not a member of that project. |
| `Type "User Story" not found. Available: …` | Enable User Story in the project's settings (see 3.2), or check the spelling of the type name on your instance. |
| `Status "Closed" not found. Available: …` | Your instance names the done status differently; the list shows what exists. |
| `FAIL Current sprint: No open version named "Sprint <N>"…` | No sprint version is open in the project yet. |
| `FAIL Backlog version: …` | The backlog name doesn't match a version; the error lists the available ones. Re-run setup. (`SKIP` means none is set, which is fine.) |
| `FAIL Talk room: … 401` / raw XML in the error | Wrong `NC_USER` / `NC_APP_PASSWORD`. Use an app password, not your login password. |
| `FAIL Talk room: … 404` | Wrong `NC_TALK_ROOM` token, or you're not in that room. |
| `422 …` on create | You can't be assigned in that project, or a required custom field is missing. |
| `422 …` on close | The project's workflow doesn't allow moving to Closed from the current status for your role. |
| `/opflow:plan-feature` etc. not found in Claude Code | Open `/plugin`, check that opflow is installed and enabled, then restart the Claude Code session. |
| No approval prompt from Claude Code before writes | The `ask` rules from 3.5 aren't in `~/.claude/settings.json`. |

---

## 9. Development

```bash
npm test            # runs all unit tests (node --test), no network needed
```

- ES modules, Node's built-in `fetch`, `node:test` and `node:assert` — no dependencies.
- API clients take an injectable `fetch`; the CLI's `run(argv, deps)` takes injectable clients, file reader,
  file remover and logger, so every command is tested without touching real services.
- To try changes, add your clone as a marketplace (`claude plugin marketplace add <clone path>`) and install
  `opflow@opflow`; `claude plugin validate .` checks the manifests.
- Bump `version` in both `package.json` and `.claude-plugin/plugin.json` for each release.

---

## 10. Known limitations

- `/opflow:done-tasks` only sees stories **updated today**; for older ones, name the ids (`/opflow:done-tasks 101 102`).
- `op:today` returns up to 100 work packages.
- If deleting the input file fails *after* a successful write (e.g. a Windows file lock), the command exits with a
  generic error and the file stays; delete it manually before re-running.
- One OpenProject project and one Talk room per install.
- `check` doesn't verify that you're assignable in the project or that the workflow allows Closed — those surface
  as `422` errors on first use.
