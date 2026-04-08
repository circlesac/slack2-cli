---
name: slack2
description: Guide for creating and managing Slack apps via the slack2 CLI — manifest-based app creation, OAuth install, token management
user-invocable: false
---

# slack2 CLI

Slack app lifecycle management from the terminal. Uses the Slack Manifest API to create apps programmatically, then handles OAuth installation to obtain bot tokens.

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
