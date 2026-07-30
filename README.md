# slack2

Slack **app lifecycle and workspace administration** CLI. Create and manage
Slack apps, inspect workspace settings, configure profile fields, update
API-managed member profiles, and read access or audit logs from the terminal.

```bash
slack2 list                                   # apps you can manage
slack2 import A0123456789                      # pull an app's credentials into local config
slack2 webhook get A0123456789 --channel ops  # print a channel's incoming webhook URL
slack2 admin workspace show -w example         # inspect workspace identity and plan
slack2 admin member list -w example            # list workspace members
slack2 admin access-log list -w example        # redacted workspace access log
```

## Install

```bash
# Homebrew (recommended)
brew install circlesac/tap/slack2

# npm
npm install -g @circlesac/slack2-cli
```

## Authentication

`slack2` uses your Slack browser session for app-management pages and workspace
administration surfaces that Slack does not expose through a stable public API.

```bash
slack2 login                         # reads the first Slack browser session
slack2 login --workspace example     # selects a browser or desktop-app session for one workspace
```

The session is saved under the XDG state directory (normally
`~/.local/state/slack2/cookies.json`). Re-run `slack2 login` if a command
reports that the session expired. Imported app metadata is stored under the XDG
cache directory (normally `~/.cache/slack2/apps.json`).

Manifest lifecycle commands also use the official Slack CLI credentials in
`~/.slack/credentials.json`.

## Commands

| Command | Args / options | What it does |
|---|---|---|
| `login` | `-w/--workspace` | Save a matching Slack browser or desktop-app session |
| `create` | `<manifest>` | Create an app via the Manifest API |
| `install` | `<APP-ID>` | Install a created app to the workspace (OAuth) → bot token |
| `list` | — | List Slack apps from api.slack.com |
| `update` | `<APP-ID>` | Update an app's manifest |
| `delete` | `<APP-ID>` | Delete an app via the Manifest API |
| `token` | `<APP-ID>` | Print the bot token for an app |
| `import` | `<APP-ID>` `-w/--workspace` `-f/--force` | Import an externally-created app into local config (scrapes client/signing secret) |
| `webhook list` | `<APP-ID>` `--json` | List the app's incoming webhooks (channel + URL) |
| `webhook get` | `<APP-ID>` `--channel <name>` | Print one channel's incoming webhook URL (scriptable) |
| `webhook add` | `<APP-ID>` | Mint a new incoming webhook via OAuth (pick the channel on the consent screen) |
| `admin whoami` | `-w/--workspace` `--json` | Show the signed-in member's workspace role |
| `admin workspace show/update` | `-w/--workspace` name, locale, or DND options | Inspect identity/plan and manage workspace-wide defaults |
| `admin member list/get` | `-w/--workspace` filters | Inspect workspace membership |
| `admin channel list/get` | `-w/--workspace` filters | Inspect channels visible to the signed-in admin |
| `admin emoji list` | `-w/--workspace` `--aliases` | List custom emoji and aliases |
| `admin invitation list/show/update` | `-w/--workspace` type/domain options | Inspect invitation history and manage approved-domain joining |
| `admin profile-field list/get` | `-w/--workspace` `--json` | Inspect field source, visibility, and allowed writers |
| `admin profile-field update` | `<field>` `--source member\|api\|scim` `--visible\|--hidden` | Change one field with a diff, confirmation, and `--dry-run` |
| `admin member-profile get` | `<member>` `-w/--workspace` | Read one member profile |
| `admin member-profile update` | `<member>` `--title` `--field <id>=<value>` | Update API-managed values with confirmation and `--dry-run` |
| `admin profile-policy show/update` | `-w/--workspace` display/editor options | Manage profile display and schema-editor policies |
| `admin channel-policy show/update` | `-w/--workspace` message options | Manage message editing, join/leave, and mention-warning policies |
| `admin retention show/update` | `-w/--workspace` scope/mode/days | Manage message, file, canvas, and list retention |
| `admin auth show` | `-w/--workspace` | Show a whitelisted authentication summary |
| `admin billing show/history` | `-w/--workspace` | Show plan, renewal, seat count, cost, and redacted billing events |
| `admin audit-log list` | `-w/--workspace` filters | Read Enterprise Audit Logs API events |
| `admin access-log list` | `-w/--workspace` filters | Read paid-workspace access logs |

App IDs look like `A0123456789` — find them with `slack2 list`.

### Official Slack CLI boundary

`slack2` does not manage app display profiles or icons. Use the official Slack CLI and app manifest for `display_information` (`name`, `description`, `long_description`, and `background_color`) and app icons.

The browser session used by `slack2 login` is reserved for operations that the
public Slack APIs and official CLI do not expose: discovering all apps,
importing existing app secrets, looking up incoming webhook URLs, reading
workspace-admin state, and publishing profile field configuration.

## Workspace administration

Every admin command requires an explicit workspace domain:

```bash
# Verify the session and role
slack2 admin whoami --workspace example

# Actual workspace resources
slack2 admin workspace show --workspace example
slack2 admin member list --workspace example --role owner
slack2 admin channel list --workspace example --type public
slack2 admin emoji list --workspace example --aliases
slack2 admin invitation list --workspace example --type pending

# Workspace policy changes
slack2 admin profile-policy update \
  --workspace example \
  --display-phone enabled \
  --dry-run
slack2 admin channel-policy update \
  --workspace example \
  --message-edit-window 60 \
  --dry-run
slack2 admin invitation update \
  --workspace example \
  --domain-join enabled \
  --domains example.com \
  --dry-run
slack2 admin retention update \
  --workspace example \
  --scope public \
  --mode delete-after \
  --days 365 \
  --dry-run

# Profile field schema
slack2 admin profile-field list --workspace example
slack2 admin profile-field get Title --workspace example --json
slack2 admin profile-field update Title \
  --workspace example \
  --source api \
  --dry-run

# Member profile values (only API-managed fields can be written)
slack2 admin member-profile get U0123456789 --workspace example
slack2 admin member-profile update U0123456789 \
  --workspace example \
  --title "Engineering" \
  --field "Alternate Phone=+1 555 0100" \
  --dry-run
```

Field names must match exactly. IDs are safer for automation. Ambiguous member
or field names are rejected rather than resolved to the first match.

Mutating commands always print a before/after diff. They require interactive
confirmation unless `--yes` is supplied, and support `--dry-run` without
sending the write request.

### Profile data sources

- `member`: the member can edit the value in Slack.
- `api`: owners/admins with an eligible user token can update it through
  `users.profile.set`; members cannot edit it directly.
- `scim`: the mapped identity provider/SCIM integration owns the value.

Slack's admin profile editor publishes the entire profile schema at once.
`slack2` reads the latest schema, modifies exactly one resolved field, displays
the diff, and then publishes the complete schema only after confirmation.

Available sources are resolved from each field's live workspace schema. Do not
assume that two workspaces expose the same choices: for example, a Pro
workspace may offer only `member` and `api`, while an eligible Business+
workspace can additionally expose `scim`. Unsupported choices fail before any
write request is sent.

Workspace policy changes use the same browser-backed Slack admin forms as the
web admin UI. `--dry-run` also checks that the relevant form exists for the
current owner, plan, and organization context. A setting available on
Business+ may therefore fail cleanly on Pro instead of being treated as a
false/default value.

Retention writes are intentionally explicit: update one scope at a time, and
provide `--days` for a delete-after mode. The confirmation warns when a policy
can permanently remove messages or retained content.

### Audit logs and access logs

These are separate data sets and commands:

- `admin audit-log list` uses Slack's Audit Logs API. It requires an Enterprise
  organization, an org-owner `xoxp` user token, and `auditlogs:read`. Select a
  locally installed app with `--app-id`, or set `SLACK2_AUDIT_TOKEN`.
- `admin access-log list` uses `team.accessLogs` and is available on eligible
  paid workspaces to owners/admins.

Network identifiers (`ip`, `ip_address`, `isp`, and `user_agent`) are redacted
by default, including in JSON. Pass `--include-network` only when those values
are needed for an authorized investigation.

### Incoming webhooks

Slack incoming webhooks belong to a **specific app + channel**, and their URLs aren't exposed by the Slack Web API — normally you have to dig them out of the app's config page. `webhook list/get` read them from that page using your saved session; `webhook add` runs the OAuth install flow to create a new one.

```bash
# See every webhook configured on an app
slack2 webhook list A0123456789

# Grab one channel's URL (e.g. to feed an alerting integration)
HOOK=$(slack2 webhook get A0123456789 --channel alerts)

# Create a new webhook — choose the target channel in the browser
slack2 webhook add A0123456789
```

## Notes

- App lifecycle commands operate per app (`<APP-ID>`); admin commands operate
  per explicit workspace (`--workspace`).
- Saved sessions, app credentials, and webhook URLs are secrets. Treat the
  slack2 XDG state/cache files accordingly and never commit captured values.

## Release

Releases run through GitHub Actions (CalVer via `@circlesac/oneup`) — multi-platform binaries, npm publish, and a Homebrew tap update. Do not bump versions or publish by hand. See [CLAUDE.md](CLAUDE.md).
