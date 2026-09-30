# opflow — Tickets + daily reports for Claude Code

opflow is a Claude Code plugin that does two jobs. It plans your work into OpenProject sprints by points, and it
posts end-of-day reports to Nextcloud Talk. Nothing is written until you approve it.

Everyone uses **their own** OpenProject and Nextcloud accounts. Full reference: [DOCUMENTATION.md](DOCUMENTATION.md).

---

## Install

In Claude Code:

```
/plugin marketplace add <owner>/opflow
/plugin install opflow@opflow
/opflow:setup
```

Two requirements:
- **Repo access:** the repo is private, so your git must already be able to clone it (e.g. `gh auth login`).
- **Node.js 18+.**

## What setup asks for

| # | Item | Where to get it |
|---|---|---|
| 1 | OpenProject URL | The browser address bar, without the path, e.g. `https://openproject.example.com` |
| 2 | OpenProject API token | OpenProject → avatar (top right) → **My account** → **Access tokens** → **API** → **+ API token**. Copy it right away; it is shown once. |
| 3 | OpenProject project | The identifier in the project URL: `/projects/<identifier>/…` |
| 4 | Your team's backlog version | OpenProject → project → **Backlogs**. Use the exact name, e.g. `Backlog: Android POS` or `Backlog: ERP`. |
| 5 | Nextcloud URL | The browser address bar, e.g. `https://cloud.example.com` |
| 6 | Nextcloud username | Nextcloud → avatar → **Settings** → **Personal info** (the login name, not the display name) |
| 7 | Nextcloud app password | Nextcloud → **Settings** → **Security** → **Devices & sessions** → name it `opflow` → **Create new app password**. Not your login password. |
| 8 | Talk room token | Open the room in Talk; the token is the part after `/call/` in the URL. Your own "Note to self" room is good for a first test. |

`/opflow:setup` shows you a command to run in your own terminal:
- **Hidden input:** it hides what you type for the token and the app password. Never paste those into the chat.
- **Where settings go:** they're saved in `~/.opflow/` and survive plugin updates.
- **Re-running:** run `/opflow:setup` any time. Pressing Enter keeps each current value.

Your accounts also need:

- **OpenProject:** membership in the project, with a role that can create and edit work packages, be assigned to
  them, and set their version. The **User Story** type must be enabled in the project.
- **Nextcloud:** membership in the Talk room you post to.

## Recommended: approval rules

Add both of these to `permissions.ask` in `~/.claude/settings.json`, so Claude Code asks you before every write:

```json
{
  "permissions": {
    "ask": ["Bash(node *opflow.js*--yes*)", "PowerShell(node *opflow.js*--yes*)"]
  }
}
```

## Daily use (in any project, in Claude Code)

The commands only run when you type them. Claude never starts them on its own while you're working on something
else. At the start of each new session, Claude mentions them once, in one line.

- `/opflow:plan-feature add CSV export to the invoices page`: Claude breaks the feature into User Stories with
  points and shows where each one goes. Approve, and they're created and assigned to you.
- `/opflow:done-tasks`: review which stories are finished. Approve, and they're set to Closed.
- `/opflow:report-day`: review the drafted daily report. Approve, and it's posted to your Talk room.

### How points and sprints work

| Points | Time | Stored in OpenProject as |
|---|---|---|
| 1 | 2 hours | Estimated time `2h` |
| 2 | 4 hours | Estimated time `4h` |
| 4 | 1 day (8 hours) | Estimated time `8h` |

Stories bigger than a day are split. A sprint is 2 weeks, and each dev can hold up to **60 points** in it: 40 points
of working time plus room for tasks done in parallel.

- The current sprint is found automatically: it is the open version named `Sprint <N>` with the highest N. When a
  new sprint opens, nothing needs updating.
- Your open work already in the sprint counts toward your 60. Tasks without an estimate count as 0. Teammates' tasks
  don't count toward yours.
- Stories are placed in priority order. If one doesn't fit, it goes to your backlog version, and a later, smaller
  story can still fill the room left.

### Ticket breakdown

Setup asks how `/opflow:plan-feature` should break your work into tickets:

| Question | Options (first is the default) |
|---|---|
| Unit tests / testing work | In acceptance criteria · Excluded · Separate ticket per feature |
| Ticket size | Balanced (2–4 pts, max 8) · Fewer, bigger (mostly 4 pts, max 5) · Detailed (1–2 pts, technical tasks allowed, max 10) |
| Docs and deployment work | In acceptance criteria · Excluded · Separate tickets |

Every option keeps the same basics:
- each ticket is one outcome a project manager can check;
- there are no tickets for code review or refactoring on their own;
- a final merge/split pass runs before you see the table.

Change your answers by re-running `/opflow:setup`. To keep them while changing credentials, add
`--keep-preferences` to the setup command.

### Your report format

`/opflow:report-day` fills in `~/.opflow/report-template.md`. Setup creates it from the default format, and it's
yours to change:

- Rename, reorder, add or remove sections, or change the title line. Talk renders Markdown.
- `{{date}}` becomes today's date.
- `<!-- comments -->` are instructions for Claude, e.g. `<!-- one line per task, no ticket numbers -->`. They are
  followed but never posted.

To go back to the default, delete `~/.opflow/report-template.md` and re-run `/opflow:setup`.

## Updating

Run `/plugin update opflow`, or turn on auto-update for the marketplace in `/plugin`. Your `~/.opflow/` folder is
never touched by updates.

## APIs this uses

All calls use **your** credentials:
- **OpenProject:** Basic auth `apikey:<API token>`.
- **Nextcloud:** Basic auth `<username>:<app password>`, plus the header `OCS-APIRequest: true`.

| Used by | Request |
|---|---|
| check, plan | `GET /api/v3/users/me` |
| check | `GET /api/v3/projects/{project}` |
| check, plan | `GET /api/v3/projects/{project}/types` (finds "User Story") |
| check, done | `GET /api/v3/statuses` (finds "Closed") |
| check, plan | `GET /api/v3/projects/{project}/versions` (current sprint and backlog) |
| plan | `GET /api/v3/projects/{project}/work_packages?filters=…` (your open tasks in the sprint) |
| plan (on approve) | `POST /api/v3/projects/{project}/work_packages` |
| done (on approve) | `GET` + `PATCH /api/v3/work_packages/{id}` |
| report | `GET /api/v3/projects/{project}/work_packages?filters=…` (your tasks updated today) |
| check | `GET /ocs/v2.php/apps/spreed/api/v4/room/{room token}` |
| report (on approve) | `POST /ocs/v2.php/apps/spreed/api/v1/chat/{room token}` |

## CLI

The skills call this for you. You only need it for setup, or when debugging:

```
node "<plugin folder>/bin/opflow.js" setup [--keep-preferences]
node "<plugin folder>/bin/opflow.js" plan:rules
node "<plugin folder>/bin/opflow.js" check
node "<plugin folder>/bin/opflow.js" op:create --file tasks.json [--yes]
node "<plugin folder>/bin/opflow.js" op:done <id...> [--yes]
node "<plugin folder>/bin/opflow.js" op:today [--json]
node "<plugin folder>/bin/opflow.js" talk:post --file report.md [--yes]
```

Write commands are dry runs unless `--yes` is given. `/opflow:setup` shows the exact plugin folder path.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `opflow is not set up` | Run `/opflow:setup`. |
| `setup needs a terminal` | Copy the printed command into your own terminal. Running it with `!` inside Claude Code doesn't work. |
| `/opflow:…` commands missing | Open `/plugin`, check that opflow is installed and enabled, then restart Claude Code. |
| `FAIL OpenProject user: … 401` | Wrong or revoked API token, or wrong OpenProject URL. Re-run setup. |
| `FAIL OpenProject project: … 404` | Wrong project identifier, or you're not a member of the project. |
| `FAIL Current sprint: No open version named "Sprint <N>"` | No sprint is open yet. Ask whoever runs the sprint to open it. |
| `FAIL Backlog version: … not found. Available: …` | The backlog name doesn't match. Copy the exact name from the list into setup. |
| `FAIL Talk room: … 401` | Wrong Nextcloud username or app password. Use an app password. |
| `FAIL Talk room: … 404` | Wrong room token, or you're not in that room. |

More in [DOCUMENTATION.md](DOCUMENTATION.md#8-troubleshooting).

## Developing opflow

1. Clone the repo and run `npm test`. It needs no dependencies.
2. To try local changes, add the clone as a marketplace with `claude plugin marketplace add <clone path>`, then
   `claude plugin install opflow@opflow`.
3. For each release, bump `version` in both `package.json` and `.claude-plugin/plugin.json`.
