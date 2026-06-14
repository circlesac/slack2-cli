# slack2

Slack **app lifecycle** CLI — create, install, inspect, and manage Slack apps (and their incoming webhooks) from the terminal, using your existing browser session. No bot token juggling, no clicking through `api.slack.com/apps`.

```bash
slack2 list                                   # apps you can manage
slack2 import A0123456789                      # pull an app's credentials into local config
slack2 webhook get A0123456789 --channel ops  # print a channel's incoming webhook URL
```

## Install

```bash
# Homebrew (recommended)
brew install circlesac/tap/slack2

# npm
npm install -g @circlesac/slack2-cli
```

## Authentication

`slack2` drives the Slack app-management UI/APIs as **you**, via your browser session — there's no separate API token to provision.

```bash
slack2 login    # reads the Slack session cookie from Chrome / the Slack app
```

The session is saved to `~/.config/slack2/cookies.json`. Re-run `slack2 login` if a command reports the session expired. App credentials imported with `slack2 import` are stored in `~/.config/slack2/apps.json`.

## Commands

| Command | Args / options | What it does |
|---|---|---|
| `login` | — | Save the Slack session from browser cookies |
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

App IDs look like `A0123456789` — find them with `slack2 list`.

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

- Commands operate per app (`<APP-ID>`); there is no workspace-wide aggregation — that mirrors Slack's own model, where webhooks and credentials are app-scoped.
- Credentials and webhook URLs are secrets. Treat `~/.config/slack2/` accordingly and don't commit captured values.

## Release

Releases run through GitHub Actions (CalVer via `@circlesac/oneup`) — multi-platform binaries, npm publish, and a Homebrew tap update. Do not bump versions or publish by hand. See [CLAUDE.md](CLAUDE.md).
