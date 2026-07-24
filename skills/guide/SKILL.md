---
name: slack2
description: Guide for creating and managing Slack apps via the slack2 CLI — manifest-based app creation, OAuth install, token management
user-invocable: false
---

# slack2 CLI

Slack app lifecycle management from the terminal. Uses the Slack Manifest API to create apps programmatically, then handles OAuth installation to obtain bot tokens.

## Tool boundary

Use `slack2` for the workflows that the public Slack APIs and official CLI do not expose conveniently:

- Discovering all apps from the app-management page
- Importing an existing app's client and signing secrets
- Listing or retrieving existing incoming webhook URLs

Do not use or extend `slack2` for app display profiles or icons. Manage `display_information` (`name`, `description`, `long_description`, and `background_color`) through the app manifest and use the official Slack CLI for manifest synchronization and icon upload.

`slack2 login` captures a browser session only for `list`, `import`, and `webhook list/get`. Normal manifest lifecycle commands use the official Slack CLI credentials in `~/.slack/credentials.json`.

## Prerequisites

- Slack CLI installed and authenticated (`slack login`) — credentials stored at `~/.slack/credentials.json`
- The workspace domain must match what's in credentials

## Workflow

```bash
# 1. Create an app
slack2 create "My Bot" -w circlesac -s "chat:write,channels:read"

# 2. Install it (opens browser once for OAuth)
slack2 install <app-id>

# 3. Get the bot token
slack2 token <app-id>
slack2 token <app-id> | pbcopy  # copy to clipboard

# 4. Manage
slack2 list                     # show all tracked apps
slack2 update <app-id> -m manifest.json  # update manifest
slack2 delete <app-id>          # remove app
```

## Config

App metadata stored at `~/.config/slack2/apps.json` — includes app_id, client_id, client_secret, and bot_token after install.
