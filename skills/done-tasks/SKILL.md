---
name: done-tasks
description: Match today's journal (features built, bugs fixed) to OpenProject tickets and close, comment on or create them only after the user approves. Use when the user runs /opflow:done-tasks.
disable-model-invocation: true
---

# Reconcile today's work with OpenProject

1. Run (add `--date YYYY-MM-DD` if the user named a day):

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/bin/opflow.js" reconcile:candidates
   ```
   If it says opflow is not set up, tell the user to run `/opflow:setup` and stop. If `projects` and `unmapped` are both empty, use the **fallback** at the end.
2. For each entry in `unmapped`, ask the user once with AskUserQuestion: map it to the configured project (`configuredProject`), to another OpenProject project identifier, or never ticket it. Save the answer, then run `reconcile:candidates` again:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/bin/opflow.js" project:map <project> <identifier>
   node "${CLAUDE_PLUGIN_ROOT}/bin/opflow.js" project:map <project> --never
   ```
   Show any project that has an `error` to the user and leave it out.
3. For each item, compare it with its `matches` and the project's `openTickets` (read their descriptions and acceptance criteria). A ticket matches only if it describes the same outcome, not just similar words. Choose one action:

   | Situation | Action |
   |---|---|
   | `done`, has `commit`, matching ticket whose acceptance criteria this work meets | `close` |
   | `partial`, or done but not every criterion met | `comment` with a short progress note |
   | `done`, has `commit`, no matching ticket | `create` with `"closed": true` |
   | `partial`, no matching ticket | `create` with `"closed": false` |
   | no `commit`, or several tickets could match | no action — give the reason |

   Never close, or create a Closed ticket, without a `commit`.
4. Write the actions as a JSON array to `~/.opflow/reconcile.json`. Every action has `"project"` (the journal project), `"date"` (the date used in step 1), `"note"` (copied from the item) and `"action"`, plus:
   - `close`: `"ticket"`
   - `comment`: `"ticket"`, `"comment"` (Markdown, 1–3 sentences on what was done)
   - `create`: `"subject"` (imperative, at most 80 characters), `"description"` (1–3 sentences, then `**Acceptance criteria**` as a checklist, ticked for what was done), `"points"` (`1`, `2` or `4`), `"closed"`

   Then run the dry run (it changes nothing):

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/bin/opflow.js" reconcile:apply --file ~/.opflow/reconcile.json
   ```
   If writing the file fails or the dry run prints `Error:`, fix the file if the error says how; otherwise stop and tell the user — never run the `--yes` command.
5. Show one table — `Project | Work | Ticket | Action | Evidence` — including the no-action items with their reason, followed by the dry run lines. Ask with AskUserQuestion: **Approve**, **Edit**, **Cancel**.
   - **Edit** → apply the changes, rewrite the file, run the dry run again, show the table again, ask again.
   - **Cancel** → stop. Nothing is changed.
6. Only after **Approve**, run:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/bin/opflow.js" reconcile:apply --file ~/.opflow/reconcile.json --yes
   ```
7. Show the result lines. Report any `FAILED` lines verbatim; running `/opflow:done-tasks` again later retries only what wasn't done.

**Fallback (nothing in the journal):** run `node "${CLAUDE_PLUGIN_ROOT}/bin/opflow.js" op:today --json`, decide from this conversation which open items are actually finished (acceptance criteria met), show them as `#id subject — why it's done`, ask **Approve / Edit / Cancel**, and only after **Approve** run:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/bin/opflow.js" op:done <id> <id> ... --yes
   ```

Never run a command with `--yes` without an explicit **Approve** from the user for that exact list in this conversation.
