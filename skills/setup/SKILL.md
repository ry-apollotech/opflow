---
name: setup
description: Connect opflow to the user's own OpenProject and Nextcloud accounts. Use when the user runs /opflow:setup.
disable-model-invocation: true
---

# Set up opflow

1. Tell the user that setup asks for these values in their own terminal, and where to find each:

   | Value | Where to get it |
   |---|---|
   | OpenProject URL | Browser address bar, e.g. `https://openproject.example.com` |
   | OpenProject API token | OpenProject → avatar → **My account** → **Access tokens** → **API** → **+ API token** |
   | Project identifier | The part after `/projects/` in the project URL |
   | Backlog version name | OpenProject → project → **Backlogs**, e.g. `Backlog: Android POS` |
   | Nextcloud URL | Browser address bar, e.g. `https://cloud.example.com` |
   | Nextcloud username | **Settings** → **Personal info** (login name) |
   | Nextcloud app password | **Settings** → **Security** → **Devices & sessions** → **Create new app password** |
   | Talk room token | Open the room; the part after `/call/` in the URL |

   It then asks three questions about how tickets are broken down, and creates their report template.
2. Tell them **not to paste tokens or passwords into this chat**, and to run this in their own terminal (not with `!` here, because it needs a real terminal to hide what they type):

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/bin/opflow.js" setup
   ```

   Re-running it later keeps current values when they press Enter. Add `--keep-preferences` to skip the three questions.
3. When they say it's done, run:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/bin/opflow.js" check
   ```

   If every line starts with `OK`, tell them they can use `/opflow:plan-feature`, `/opflow:done-tasks` and `/opflow:report-day`. For any `FAIL` line, explain the likely cause from the error text and ask them to re-run setup.

Never ask for, repeat, or write credentials yourself.
