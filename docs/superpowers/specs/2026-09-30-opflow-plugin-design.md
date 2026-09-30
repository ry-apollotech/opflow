# opflow as a Claude Code plugin — design

**Date:** 2026-09-30
**Status:** draft, awaiting review

## Goal

Teammates install opflow from inside Claude Code instead of cloning the repo and running `npm run install-skills`:

```
/plugin marketplace add <org>/<repo>
/plugin install opflow@opflow
/opflow:setup
```

Each dev uses their own OpenProject and Nextcloud accounts, ticket-breakdown preferences and report format. None of
these are lost when the plugin updates.

## Decisions (from discussion)

- **Distribution:** a private GitHub repo that is both the plugin and its own marketplace. Installing needs the
  dev's git to already have access to that repo.
- **Config location:** `~/.opflow/` in each dev's home folder, filled by an interactive `setup` command that the
  dev runs in their own terminal (approach 1). Plugin `userConfig` was rejected because its values reach hooks but
  not the Bash commands Claude runs, and those commands are how the CLI is called.
- **Unchanged behaviour:**
  - points (1/2/4 = 2h/4h/8h), the 60-point sprint with backlog overflow, dry-run-by-default writes;
  - skills only run when typed (`disable-model-invocation: true`);
  - the session reminder;
  - the report template;
  - the three ticket-breakdown questions.

## Non-goals

- claude.ai / Cowork support (they don't support this plugin's components, and they can't reach internal
  OpenProject/Nextcloud).
- Plugins can't edit a dev's permissions, so the `--yes` ask rules stay a manual, printed step.
- Publishing to a public marketplace.

## Layout

```
.claude-plugin/
  plugin.json          name "opflow", version, description, author
  marketplace.json     name "opflow", one plugin: { "name": "opflow", "source": "./" }
hooks/hooks.json       SessionStart (matcher "startup") → node "${CLAUDE_PLUGIN_ROOT}/scripts/session-reminder.js"
skills/
  setup/SKILL.md       new: /opflow:setup
  plan-feature/        /opflow:plan-feature
  done-tasks/          /opflow:done-tasks
  report-day/          /opflow:report-day
bin/opflow.js          CLI (adds: setup, plan:rules)
src/                   + home.js (config dir), setup.js (interactive setup)
scripts/preferences.js unchanged questions/rules; now used by setup and plan:rules
report-template.example.md
```

Removed:
- `scripts/install.js` and `npm run install-skills`. The plugin ships the skills and the hook, so there's nothing
  to render or copy.
- `{{OPFLOW}}` / `{{DATA_DIR}}` / `{{REPORT_TEMPLATE}}` / `{{PLAN_RULES}}` placeholders. Skills use
  `${CLAUDE_PLUGIN_ROOT}`, which Claude Code substitutes in skill content.

`isMainModule`, which `session-reminder.js` still needs, moves to `src/main-module.js`. Ryan's uncommitted
drive-path fix to it is carried over only after Ryan agrees; see Open questions.

## Per-user folder: `~/.opflow/`

| File | Written by | Purpose |
|---|---|---|
| `.env` | setup | OP_URL, OP_API_KEY, OP_PROJECT, OP_BACKLOG, NC_URL, NC_USER, NC_APP_PASSWORD, NC_TALK_ROOM |
| `preferences.json` | setup | ticket-breakdown answers |
| `report-template.md` | setup, copied from the example only if missing | the dev's `/report-day` format |
| `tasks.json`, `report.md` | skills | working files, deleted after a successful `--yes` (as today) |

- **Folder location:** `$OPFLOW_HOME` if set (used by tests), otherwise `<homedir>/.opflow`.
- **Folder permissions:** created with mode `0700`. `.env` is written with mode `0600` on POSIX; on Windows
  these modes are ignored.
- **Config precedence:** environment variables override `.env`, empty ones are ignored (as today).

## CLI changes

- **Config path:** `bin/opflow.js` loads `~/.opflow/.env` instead of `<repo>/.env`.
- **Missing config:** `Error: opflow is not set up. Run /opflow:setup in Claude Code.`
- **`setup` (new, interactive, needs a terminal):**
  1. Ask each credential in turn. Current values are shown as defaults, with secrets masked as `****1234`. Secret
     input (`OP_API_KEY`, `NC_APP_PASSWORD`) is not echoed. Enter keeps the current value.
  2. Write `~/.opflow/.env`.
  3. Ask the three ticket-breakdown questions, or with `--keep-preferences` keep the saved answers. Save
     `preferences.json`.
  4. Create `report-template.md` if it's missing.
  5. Run `check` and print its result.
  6. Print the two `--yes` ask rules to add to `~/.claude/settings.json`.
  7. Migration: if `~/.opflow/.env` doesn't exist but `<plugin or repo root>/.env` or `$OPFLOW_MIGRATE_FROM`
     does, offer to use it as the starting values.
  8. Without a terminal, exit 1 with "Run this in a terminal: node "<path>" setup".
- **`plan:rules` (new, read-only):** prints the breakdown rules for the saved preferences, or the defaults if none
  are saved. `/opflow:plan-feature` runs this first, since the rules can no longer be baked in at install time.
- **Other commands:** unchanged.

## Skills

- **`/opflow:setup`:**
  - Explains what setup asks for and where to get each value (the same table as the README).
  - Shows the exact command to run in the user's own terminal: `node "${CLAUDE_PLUGIN_ROOT}/bin/opflow.js" setup`.
  - Tells the user not to paste secrets into the chat.
  - After they say it's done, runs `check` and reports the result.
  - It does not run `setup` itself, because setup needs a real terminal for the hidden input.
- **`/opflow:plan-feature`:**
  - Step 2 starts with `node "${CLAUDE_PLUGIN_ROOT}/bin/opflow.js" plan:rules` and follows the printed rules.
  - `tasks.json` is written to `~/.opflow/tasks.json`.
- **`/opflow:report-day`:** reads `~/.opflow/report-template.md` and writes `~/.opflow/report.md`.
- **`/opflow:done-tasks`:** only the CLI path changes.
- **All skills:** keep `disable-model-invocation: true` and the "never `--yes` without Approve" rule.
- **Paths in skills:** skills write `~/.opflow/...`. Claude expands `~` for the user's shell (Bash and PowerShell
  both accept it).

## Session reminder

- Ships in `hooks/hooks.json`, so it is on for everyone who installs the plugin.
- The text changes to the namespaced commands: `/opflow:plan-feature`, `/opflow:done-tasks`, `/opflow:report-day`.
- It adds "run `/opflow:setup` first" when `~/.opflow/.env` doesn't exist.

## Versioning and updates

- `plugin.json` `version` is bumped on every release. Devs update with `/plugin update opflow` or by
  auto-update.
- Nothing in `~/.opflow/` is touched by updates.

## Migrating Ryan's current install

Each step is confirmed before it runs:

1. Run `setup`, pre-filled from the repo `.env`.
2. Remove the old user-level copies in `~/.claude/skills/{plan-feature,done-tasks,report-day}`, which would
   otherwise show up next to the plugin's.
3. Remove the manual SessionStart hook from `~/.claude/settings.json`.
4. Add the marketplace from the local folder until the GitHub repo exists.
5. Update the `--yes` ask rules if they're added. The pattern `*opflow.js*--yes*` still matches the plugin path.

## Error handling

- **Config missing:** clear error pointing to `/opflow:setup`.
- **Broken `preferences.json`:** fall back to the defaults, as `loadPreferences` does today.
- **`setup` without a terminal:** explicit error with the command to run.
- **`plan:rules`:** can't fail, because it uses the defaults when needed.

## Testing

- **`src/home.js`:** `OPFLOW_HOME` override and the default path.
- **`setup`:** driven through an injectable `ask` function, the same way `askPreferences` is tested:
  - writes `.env` with the answers;
  - Enter keeps existing values and never prints secrets in full;
  - migration pre-fill;
  - creates the template only if missing;
  - non-terminal error.
- **`plan:rules`:** output for saved preferences and for defaults.
- **Plugin files:** `plugin.json` and `marketplace.json` parse and have the required fields. `hooks.json` points at
  an existing script. Every skill uses `${CLAUDE_PLUGIN_ROOT}/bin/opflow.js`, has `disable-model-invocation: true`,
  and keeps the approval guard. No `{{…}}` placeholders are left.
- **Manual end to end:**
  - `claude plugin marketplace add <local path>`;
  - `claude plugin install opflow@opflow`;
  - `/opflow:setup`;
  - `/opflow:plan-feature` dry run.

## Open questions

1. **GitHub repo:** org or account, and the repo name, for the README's install commands. The README can use a
   placeholder until then.
2. **Ryan's pending `isMainModule` drive-path fix** in `scripts/install.js`: carry it into `src/main-module.js` and
   commit it as part of this work?
