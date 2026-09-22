---
name: plan-feature
description: Break a feature into OpenProject User Stories and create them only after the user approves. Use when the user asks to plan or build a feature and wants it tracked in OpenProject, or runs /plan-feature.
---

# Plan a feature into OpenProject

1. Understand the feature from the user's request and, if relevant, the current codebase. Ask one clarifying question only if the scope is genuinely unclear.
2. Break it into 3–10 User Stories. Each has:
   - `subject`: imperative, at most 80 characters
   - `description`: Markdown — 1–3 sentences of context, then `**Acceptance criteria**` as a `- [ ]` checklist
3. Show them as a numbered table (`# | Subject | Acceptance criteria`), then ask with AskUserQuestion: **Approve**, **Edit**, **Cancel**.
   - **Edit** → apply the changes, show the full table again, ask again.
   - **Cancel** → stop. Nothing is created.
4. Only after **Approve**, write the stories as a JSON array of `{ "subject": "...", "description": "..." }` to `{{DATA_DIR}}/tasks.json`, then run:

   ```bash
   node "{{DFLY}}" op:create --file "{{DATA_DIR}}/tasks.json" --yes
   ```
5. Show the created `#id subject` lines. If the command reports `FAILED`, tell the user which were created and which were not, and offer to retry only the missing ones (rewrite `tasks.json` with just those and ask for approval again).

Never run a command with `--yes` without an explicit **Approve** from the user for that exact list in this conversation.
