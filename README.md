# opflow — OpenProject + Nextcloud Talk workflow for Claude Code

Plan a feature → approve → User Stories in OpenProject (sprint or backlog, by points) → approve → closed → approve →
daily report in Nextcloud Talk. Nothing is written without your approval.

Everyone uses **their own** OpenProject and Nextcloud accounts: the tool reads your personal credentials from a local
`.env` file that is git-ignored and never shared. This page covers what each dev needs and how to set it up.
Full reference: [DOCUMENTATION.md](DOCUMENTATION.md).

---

## What you need (per dev)

| # | Item | `.env` key | Where to get it |
|---|---|---|---|
| 1 | OpenProject URL | `OP_URL` | The browser address bar, without the path, e.g. `https://openproject.example.com` |
| 2 | OpenProject API token | `OP_API_KEY` | OpenProject → avatar (top right) → **My account** → **Access tokens** → **API** → **+ API token**. Copy it right away; it is shown once. |
| 3 | OpenProject project | `OP_PROJECT` | The identifier in the project URL: `/projects/<identifier>/…` |
| 4 | Your team's backlog version | `OP_BACKLOG` | OpenProject → project → **Backlogs**. Use the exact name, e.g. `Backlog: Android POS` or `Backlog: ERP`. |
| 5 | Nextcloud URL | `NC_URL` | The browser address bar, e.g. `https://cloud.example.com` |
| 6 | Nextcloud username | `NC_USER` | Nextcloud → avatar → **Settings** → **Personal info** (the login name, not the display name) |
| 7 | Nextcloud app password | `NC_APP_PASSWORD` | Nextcloud → **Settings** → **Security** → **Devices & sessions** → name it `opflow` → **Create new app password**. Not your login password. |
| 8 | Talk room token | `NC_TALK_ROOM` | Open the room in Talk; the token is the part after `/call/` in the URL. Your own "Note to self" room is good for a first test. |

Your accounts also need:

- **OpenProject:** membership in the project, with a role that can create and edit work packages, be assigned to
  them, and set their version. The **User Story** type must be enabled in the project.
- **Nextcloud:** membership in the Talk room you post to.

Software: **Node.js 18+** and **Claude Code**. There are no npm dependencies to install.

## Setup (about 10 minutes)

1. Get a copy of this repo folder and open a terminal in it. Keep it somewhere permanent, because the installed
   skills point at this folder.
2. Create your `.env` from the example and fill in the 8 keys from the table above:

   ```bash
   cp .env.example .env
   ```

   Put values containing spaces or `:` in quotes, e.g. `OP_BACKLOG="Backlog: Android POS"`.
   Never commit `.env` or send it to anyone; `.gitignore` already excludes it.
3. Check your access. This is read-only:

   ```bash
   node bin/opflow.js check
   ```

   Every line should start with `OK`:

   ```
   OK    OpenProject user: <your name>
   OK    OpenProject project: <project name>
   OK    Type "User Story": id 6
   OK    Status "Closed": id 13
   OK    Current sprint: Sprint 152 (id 2165)
   OK    Backlog version: Backlog: Android POS (id 2167)
   OK    Talk room: <room name>
   ```

   For any `FAIL` line, see [Troubleshooting](#troubleshooting).
4. Install the Claude Code skills (`/plan-feature`, `/done-tasks`, `/report-day`) into `~/.claude/skills`:

   ```bash
   npm run install-skills
   ```

   The first time, it asks how `/plan-feature` should break work into tickets: whether testing work and
   docs/deployment work go in acceptance criteria, get their own tickets, or are left out, and whether tickets
   should be balanced, fewer and bigger, or detailed. Press Enter for the defaults. Your answers are saved in
   `.opflow/preferences.json`, and later runs reuse them. To change them:
   `npm run install-skills -- --reconfigure`.

5. Add both of these to `permissions.ask` in `~/.claude/settings.json`, so Claude Code asks you before every write:

   ```json
   {
     "permissions": {
       "ask": ["Bash(node *opflow.js*--yes*)", "PowerShell(node *opflow.js*--yes*)"]
     }
   }
   ```

6. Optional: get a one-line reminder of the commands at the start of each new session. Add this to
   `~/.claude/settings.json`, using the exact path that `npm run install-skills` prints:

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

7. Restart Claude Code.

## Daily use (in any project, in Claude Code)

The skills only run when you type them. Claude never starts them on its own while you're working on something else.


- `/plan-feature add CSV export to the invoices page`: Claude breaks the feature into User Stories with points and
  shows where each one goes. Approve, and they're created and assigned to you.
- `/done-tasks`: review which stories are finished. Approve, and they're set to Closed.
- `/report-day`: review the drafted daily report. Approve, and it's posted to your Talk room.

### Your report format

`/report-day` fills in `report-template.md` in this folder. The installer creates it from
`report-template.example.md`, and it's git-ignored, so it's yours to change:

- Rename, reorder, add or remove sections, or change the title line. Talk renders Markdown.
- `{{date}}` becomes today's date.
- `<!-- comments -->` are instructions for Claude, e.g. `<!-- one line per task, no ticket numbers -->`. They are
  followed but never posted.

To go back to the default, delete `report-template.md` and run `npm run install-skills`.

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
- Stories are placed in priority order. If one doesn't fit, it goes to your `OP_BACKLOG` version, and a later,
  smaller story can still fill the room left.

## APIs this uses

All calls use **your** credentials: OpenProject with Basic auth `apikey:<OP_API_KEY>`, and Nextcloud with Basic auth
`<NC_USER>:<NC_APP_PASSWORD>` plus the header `OCS-APIRequest: true`.

| Used by | Request |
|---|---|
| check, plan | `GET /api/v3/users/me` |
| check | `GET /api/v3/projects/{OP_PROJECT}` |
| check, plan | `GET /api/v3/projects/{OP_PROJECT}/types` (finds "User Story") |
| check, done | `GET /api/v3/statuses` (finds "Closed") |
| check, plan | `GET /api/v3/projects/{OP_PROJECT}/versions` (current sprint and backlog) |
| plan | `GET /api/v3/projects/{OP_PROJECT}/work_packages?filters=…` (your open tasks in the sprint) |
| plan (on approve) | `POST /api/v3/projects/{OP_PROJECT}/work_packages` |
| done (on approve) | `GET` + `PATCH /api/v3/work_packages/{id}` |
| report | `GET /api/v3/projects/{OP_PROJECT}/work_packages?filters=…` (your tasks updated today) |
| check | `GET /ocs/v2.php/apps/spreed/api/v4/room/{NC_TALK_ROOM}` |
| report (on approve) | `POST /ocs/v2.php/apps/spreed/api/v1/chat/{NC_TALK_ROOM}` |

## CLI

```
node bin/opflow.js check
node bin/opflow.js op:create --file tasks.json [--yes]
node bin/opflow.js op:done <id...> [--yes]
node bin/opflow.js op:today [--json]
node bin/opflow.js talk:post --file report.md [--yes]
```

Write commands are dry runs unless `--yes` is given.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Missing config keys: …` | `.env` is missing or incomplete. It must be in this folder, next to `package.json`. |
| `FAIL OpenProject user: … 401` | Wrong or revoked `OP_API_KEY`, or wrong `OP_URL`. |
| `FAIL OpenProject project: … 404` | Wrong `OP_PROJECT`, or you're not a member of the project. |
| `FAIL Current sprint: No open version named "Sprint <N>"` | No sprint is open yet. Ask whoever runs the sprint to open it. |
| `FAIL Backlog version: … not found. Available: …` | `OP_BACKLOG` doesn't match. Copy the exact name from the list. |
| `FAIL Talk room: … 401` | Wrong `NC_USER` or `NC_APP_PASSWORD`. Use an app password. |
| `FAIL Talk room: … 404` | Wrong `NC_TALK_ROOM`, or you're not in that room. |
| `/plan-feature` not found | Run `npm run install-skills` and restart Claude Code. |

More in [DOCUMENTATION.md](DOCUMENTATION.md#8-troubleshooting).

## Tests

`npm test`
