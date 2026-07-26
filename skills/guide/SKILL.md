---
name: slack2
description: Guide for Slack app lifecycle and workspace administration via the slack2 CLI
user-invocable: false
---

# slack2 CLI

Slack app lifecycle and workspace administration from the terminal. Uses the
Slack Manifest API for apps and the signed-in browser session for workspace
admin surfaces that Slack does not expose through the official CLI.

## Tool boundary

Use `slack2` for the workflows that the public Slack APIs and official CLI do not expose conveniently:

- Discovering all apps from the app-management page
- Importing an existing app's client and signing secrets
- Listing or retrieving existing incoming webhook URLs
- Inspecting and publishing workspace profile field configuration
- Updating member values for fields configured with the API data source
- Inspecting authentication, billing, access-log, and eligible audit-log data

Do not use or extend `slack2` for app display profiles or icons. Manage `display_information` (`name`, `description`, `long_description`, and `background_color`) through the app manifest and use the official Slack CLI for manifest synchronization and icon upload.

`slack2 login` captures a browser session for `list`, `import`, `webhook
list/get`, and `admin` workspace operations. Normal manifest lifecycle commands
use the official Slack CLI credentials in `~/.slack/credentials.json`.

Never print or request the saved session cookie or workspace client token.
Admin JSON output redacts network identifiers unless `--include-network` is
explicitly requested.

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

## Workspace admin workflow

Always pass an explicit workspace domain:

```bash
# Confirm identity and role
slack2 admin whoami --workspace example

# Inspect the schema before changing it
slack2 admin profile-field list --workspace example
slack2 admin profile-field get Title --workspace example --json

# Preview, then apply one field change
slack2 admin profile-field update Title \
  --workspace example \
  --source api \
  --dry-run
slack2 admin profile-field update Title \
  --workspace example \
  --source api

# Update API-managed member values
slack2 admin member-profile update U0123456789 \
  --workspace example \
  --title "Engineering" \
  --field "Alternate Phone=+1 555 0100" \
  --dry-run
```

Data-source meanings:

- `member`: editable by the member in Slack.
- `api`: writable through `users.profile.set` by an eligible owner/admin token;
  not directly editable by the member.
- `scim`: owned by the mapped SCIM/identity-provider attribute.

Treat plan and workspace capabilities as runtime data. Inspect
`profile-field get/list` and its `valid_sources` output before proposing a
change; never assume that a source available in one workspace is available in
another. An unsupported source is rejected before confirmation or mutation.

Mutations show a before/after diff, confirm interactively, support `--dry-run`,
and reject ambiguous member or field names. Use `--yes` only for intentional
non-interactive automation.

## Logs

```bash
# Paid-workspace access activity; network identifiers are redacted by default
slack2 admin access-log list --workspace example

# Redacted plan and billing event history (no card, contact, or invoice URLs)
slack2 admin billing show --workspace example
slack2 admin billing history --workspace example

# Enterprise-only Audit Logs API
slack2 admin audit-log list \
  --workspace example \
  --app-id A0123456789 \
  --since 2026-01-01T00:00:00Z \
  --action user_login
```

Audit logs and access logs are not interchangeable. Audit Logs API access
requires Enterprise, an org-owner user token, and `auditlogs:read`. Access logs
use `team.accessLogs` on eligible paid workspaces.

## Config

App metadata is stored under the XDG cache directory (normally
`~/.cache/slack2/apps.json`). The browser session is stored under the XDG state
directory (normally `~/.local/state/slack2/cookies.json`).
