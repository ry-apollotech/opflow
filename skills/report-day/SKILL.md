---
name: report-day
description: Draft an end-of-day report from today's OpenProject activity and post it to Nextcloud Talk only after the user approves. Use when the user runs /opflow:report-day.
disable-model-invocation: true
---

# End-of-day report to Nextcloud Talk

1. Run:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/bin/opflow.js" op:today --json
   ```
   If it says opflow is not set up, tell the user to run `/opflow:setup` and stop.
2. Read the user's report template at `~/.opflow/report-template.md`. If it's missing, tell the user to run `/opflow:setup`, and stop. Draft the report by filling in that template:
   - Keep its sections, their order and its wording, and replace example lines like `#id Subject` with real items.
   - Replace `{{date}}` with today's date (YYYY-MM-DD).
   - Follow the instructions in `<!-- ... -->` comments, then leave every comment out of the report.
   - Unless the template says otherwise: **Done** = status `Closed`; **In progress** = every other status; add short notes from this conversation's work where they help.
   - If the template needs something you don't know, such as blockers or tomorrow's plan, ask the user in one question before drafting.
3. Show the exact final text, then ask with AskUserQuestion: **Approve**, **Edit**, **Cancel**.
4. Only after **Approve**, write the text to `~/.opflow/report.md`. If writing the file fails for any reason, stop and tell the user — never run the `--yes` command. Otherwise run:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/bin/opflow.js" talk:post --file ~/.opflow/report.md --yes
   ```
5. Confirm the posted message id, or show the error verbatim.

Never run a command with `--yes` without an explicit **Approve** from the user for that exact text in this conversation.
