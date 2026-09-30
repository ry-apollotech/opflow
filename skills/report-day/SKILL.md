---
name: report-day
description: Draft an end-of-day report from today's OpenProject activity and post it to Nextcloud Talk only after the user approves. Use when the user wants to report their day, send a daily update, or runs /report-day.
disable-model-invocation: true
---

# End-of-day report to Nextcloud Talk

1. Run:

   ```bash
   node "{{OPFLOW}}" op:today --json
   ```
2. Draft the report in this format (Talk renders Markdown):

   ```markdown
   **Daily report — YYYY-MM-DD**

   **Done**
   - #id Subject

   **In progress**
   - #id Subject — short note

   **Blockers**
   - None

   **Tomorrow**
   - ...
   ```
   - **Done** = status `Closed`; **In progress** = every other status.
   - Add short notes from this conversation's work where they help.
   - If blockers or tomorrow's plan are unknown, ask the user in one question before drafting.
3. Show the exact final text, then ask with AskUserQuestion: **Approve**, **Edit**, **Cancel**.
4. Only after **Approve**, write the text to `{{DATA_DIR}}/report.md`. If writing the file fails for any reason, stop and tell the user — never run the `--yes` command. Otherwise run:

   ```bash
   node "{{OPFLOW}}" talk:post --file "{{DATA_DIR}}/report.md" --yes
   ```
5. Confirm the posted message id, or show the error verbatim.

Never run a command with `--yes` without an explicit **Approve** from the user for that exact text in this conversation.
