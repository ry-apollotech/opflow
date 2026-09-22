---
name: done-tasks
description: Propose which of today's OpenProject User Stories are finished and set them to Closed only after the user approves. Use when work on planned tasks is completed, or the user runs /done-tasks.
---

# Close finished OpenProject tasks

1. Run:

   ```bash
   node "{{DFLY}}" op:today --json
   ```
   If the user named specific work package ids, use those instead.
2. From the work done in this conversation, decide which open (not `Closed`) items are actually finished. Only propose items whose acceptance criteria were met.
3. Show the proposal as a list (`#id subject — why it's done`), then ask with AskUserQuestion: **Approve**, **Edit**, **Cancel**.
4. Only after **Approve**, run:

   ```bash
   node "{{DFLY}}" op:done <id> <id> ... --yes
   ```
5. Show the result lines. Report any `FAILED` lines verbatim.

Never run a command with `--yes` without an explicit **Approve** from the user for those exact ids in this conversation.
