# dfly — OpenProject + Nextcloud Talk workflow for Claude Code

Plan a feature → approve → User Stories in OpenProject → approve → closed → approve → daily report in Nextcloud Talk.
Nothing is written without your approval.

## Setup

1. Node.js 18 or newer.
2. `cp .env.example .env` and fill it in:
   - `OP_API_KEY`: OpenProject → avatar → **My account** → **Access tokens** → API → generate.
   - `OP_PROJECT`: the project identifier from its URL (`/projects/<identifier>`).
   - `NC_APP_PASSWORD`: Nextcloud → **Settings** → **Security** → **Devices & sessions** → create app password.
   - `NC_TALK_ROOM`: open the Talk room; the token is the part after `/call/` in the URL.
3. Make sure the **User Story** type is enabled in the OpenProject project (Project settings → Work package types).
4. `node bin/dfly.js check` — every line should say `OK`.
5. `npm run install-skills` — installs `/plan-feature`, `/done-tasks`, `/report-day` into `~/.claude/skills`.
6. Add `"Bash(node *dfly.js *--yes*)"` to `permissions.ask` in `~/.claude/settings.json`.

## Daily use (in any project, in Claude Code)

- `/plan-feature add CSV export to the invoices page` — review the stories, approve, they're created and assigned to you.
- `/done-tasks` — review which stories are finished, approve, they're set to Closed.
- `/report-day` — review the report, approve, it's posted to your Talk room.

## CLI

```
node bin/dfly.js check
node bin/dfly.js op:create --file tasks.json [--yes]
node bin/dfly.js op:done <id...> [--yes]
node bin/dfly.js op:today [--json]
node bin/dfly.js talk:post --file report.md [--yes]
```

Write commands are dry runs unless `--yes` is given.

## Tests

`npm test`
