---
name: plan-feature
description: Break a feature into OpenProject User Stories and create them only after the user approves. Use when the user asks to plan or build a feature and wants it tracked in OpenProject, or runs /plan-feature.
disable-model-invocation: true
---

# Plan a feature into OpenProject

1. Understand the feature from the user's request and, if relevant, the current codebase. Ask one clarifying question only if the scope is genuinely unclear.
2. Break it into 3–10 User Stories, in priority order (most important first). Each has:
   - `subject`: imperative, at most 80 characters
   - `description`: Markdown — 1–3 sentences of context, then `**Acceptance criteria**` as a `- [ ]` checklist
   - `points`: `1` (≈2h), `2` (≈4h) or `4` (≈1 day). Split any story bigger than a day.
3. Write the stories as a JSON array of `{ "subject": "...", "description": "...", "points": N }` to `{{DATA_DIR}}/tasks.json` and run the dry run (it creates nothing):

   ```bash
   node "{{OPFLOW}}" op:create --file "{{DATA_DIR}}/tasks.json"
   ```

   The dry run finds the current sprint (the open `Sprint <N>` version), counts your open work already in it, and fills the sprint up to 60 points in priority order; stories that don't fit go to the backlog version. If writing the file fails or the dry run prints `Error:`, stop and tell the user — never run the `--yes` command.
4. Show them as a numbered table (`# | Subject | Points | Goes to | Acceptance criteria`) followed by the dry run's sprint total line, then ask with AskUserQuestion: **Approve**, **Edit**, **Cancel**.
   - **Edit** → apply the changes, rewrite `tasks.json`, re-run the dry run, show the full table again, ask again.
   - **Cancel** → stop. Nothing is created.
   Only after **Approve**, run:

   ```bash
   node "{{OPFLOW}}" op:create --file "{{DATA_DIR}}/tasks.json" --yes
   ```
5. Show the created `#id subject -> version` lines. If the command reports `FAILED`, tell the user which were created and which were not, and offer to retry only the missing ones (rewrite `tasks.json` with just those and ask for approval again).

Never run a command with `--yes` without an explicit **Approve** from the user for that exact list in this conversation.
